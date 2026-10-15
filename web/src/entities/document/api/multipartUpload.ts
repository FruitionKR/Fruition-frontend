import { apiFetch, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import { putPartWithIdleTimeout } from "@/entities/document/api/partUpload";
import type { DocumentUploadResponse } from "@/entities/document/model/document";

type Start = { ticket: string; part_size: number; part_count: number };
type PartUrl = { part_number: number; url: string };

/** 본문을 메모리에 복제하지 않고 Blob.slice를 전송한다. 동시에 최대 3개, 실패한 조각만 최대 3회 재시도한다. */
export async function uploadPdfMultipart(endpoint: string, file: File, folderId: string | null = null): Promise<DocumentUploadResponse> {
  return uploadDirectMultipart<DocumentUploadResponse>(endpoint, file, { filename: file.name, size: file.size, folder_id: folderId });
}

export type DirectMultipartOptions = {
  /** 중단하면 전송 중인 조각을 끊고 abort를 보낸 뒤 실패로 끝난다. */
  signal?: AbortSignal;
  /** 조각 안에서 바이트가 올라갈 때와 조각이 끝날 때 지금까지 올린 바이트 수를 알린다(재시도하면 그 조각만큼 줄 수 있다). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
};

/**
 * 브라우저→S3 직접 multipart 업로드(start → parts → 조각 PUT → complete, 실패하면 abort).
 * 문서(documents/uploads)와 회의 녹음(meetings/{id}/recording/uploads)이 같은 절차·이름을 쓴다. startBody만 다르다.
 */
export async function uploadDirectMultipart<T>(
  endpoint: string,
  file: Blob,
  startBody: Record<string, unknown>,
  options: DirectMultipartOptions = {}
): Promise<T> {
  const { signal, onProgress } = options;
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error("파일 업로드가 중단되었습니다.");
  };
  throwIfCancelled();
  const started = await apiFetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(startBody)
  });
  const upload = await parseJsonOrThrow<Start>(started, ERROR_MESSAGES.uploadFailed);
  const idempotencyKey = crypto.randomUUID();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  // 조각 번호 → 그 조각에서 지금까지 보낸 바이트. 동시에 보내는 조각을 합해 진행률을 낸다.
  // 서버 part_size가 64 MiB 이상이라 조각이 끝날 때만 세면 대부분의 녹음이 0%에서 100%로 바로 뛴다.
  const sentByPart = new Map<number, number>();
  const reportProgress = (partNumber: number, sent: number) => {
    sentByPart.set(partNumber, sent);
    let total = 0;
    for (const bytes of sentByPart.values()) total += bytes;
    onProgress?.(total, file.size);
  };
  try {
    throwIfCancelled();
    if (!Number.isSafeInteger(upload.part_size) || upload.part_size < 1
        || !Number.isSafeInteger(upload.part_count) || upload.part_count < 1 || upload.part_count > 10000
        || upload.part_count !== Math.ceil(file.size / upload.part_size)) {
      throw new Error("파일 분할 정보가 올바르지 않습니다.");
    }
    for (let first = 1; first <= upload.part_count; first += 3) {
      const count = Math.min(3, upload.part_count - first + 1);
      const batch = await apiFetch(`${endpoint}/parts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: upload.ticket, first_part: first, count })
      });
      const { parts } = await parseJsonOrThrow<{ parts: PartUrl[] }>(batch, ERROR_MESSAGES.uploadFailed);
      if (parts.length !== count || parts.some((part, index) => part.part_number !== first + index)) {
        throw new Error("파일 분할 정보가 올바르지 않습니다.");
      }
      // 한 조각이 실패해도 이미 전송 중인 조각이 종료된 후 abort한다.
      const results = await Promise.allSettled(parts.map(async part => {
        const start = (part.part_number - 1) * upload.part_size;
        const body = file.slice(start, Math.min(start + upload.part_size, file.size));
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              const refreshed = await apiFetch(`${endpoint}/parts`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket: upload.ticket, first_part: part.part_number, count: 1 })
              });
              const { parts: renewed } = await parseJsonOrThrow<{ parts: PartUrl[] }>(refreshed, ERROR_MESSAGES.uploadFailed);
              if (renewed.length !== 1 || renewed[0].part_number !== part.part_number) throw new Error("파일 분할 정보가 올바르지 않습니다.");
              part = renewed[0];
            }
            // 진행이 멈춘 시간만 제한한다. 제한이 없으면 블랙홀이 된 조각에서 업로드 전체가 매달린다.
            const partNumber = part.part_number;
            const response = await putPartWithIdleTimeout(part.url, body, controller.signal,
              onProgress ? (sent) => reportProgress(partNumber, sent) : undefined);
            if (response.ok) {
              reportProgress(partNumber, body.size);
              return;
            }
            if (response.status < 500 && response.status !== 429) {
              throw new Error(`파일 조각 전송 실패 (${response.status})`);
            }
          } catch (error) {
            if (attempt === 2 || controller.signal.aborted) throw error;
          }
          // 실패한 시도에서 보낸 바이트는 다시 보낸다.
          if (onProgress) reportProgress(part.part_number, 0);
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        }
        throw new Error("파일 조각 전송에 실패했습니다.");
      }));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
      throwIfCancelled();
    }
    // 등록 재시도에서도 같은 키를 사용해 중복 문서를 만들지 않는다.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completed = await apiFetch(`${endpoint}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ ticket: upload.ticket })
        });
        if (completed.status < 500 || attempt === 2) {
          return await parseJsonOrThrow<T>(completed, ERROR_MESSAGES.uploadFailed);
        }
      } catch (error) {
        if (attempt === 2) throw error;
      }
      // 조각 전송과 같은 backoff를 지킨다. 즉시 재시도하면 힘들어하는 서버를 연달아 때린다.
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw new Error(ERROR_MESSAGES.uploadFailed);
  } catch (error) {
    controller.abort();
    // 실패한 미완성 파트를 회수한다. 탭 종료 등 실패 시 S3 lifecycle이 나머지를 정리한다.
    await apiFetch(`${endpoint}/abort`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: upload.ticket })
    }).catch(() => undefined);
    throwIfCancelled();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
