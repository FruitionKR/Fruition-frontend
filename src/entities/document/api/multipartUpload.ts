import { apiFetch, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import type { DocumentUploadResponse } from "@/entities/document/model/document";

type Start = { ticket: string; part_size: number; part_count: number };
type PartUrl = { part_number: number; url: string };

/** 본문을 메모리에 복제하지 않고 Blob.slice를 전송한다. 동시에 최대 3개, 실패한 조각만 최대 3회 재시도한다. */
export async function uploadPdfMultipart(endpoint: string, file: File): Promise<DocumentUploadResponse> {
  const started = await apiFetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size })
  });
  const upload = await parseJsonOrThrow<Start>(started, ERROR_MESSAGES.uploadFailed);
  const idempotencyKey = crypto.randomUUID();
  const controller = new AbortController();
  try {
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
            const response = await fetch(part.url, {
              method: "PUT", body, credentials: "omit", signal: controller.signal
            });
            if (response.ok) return;
            if (response.status < 500 && response.status !== 429) {
              throw new Error(`파일 조각 전송 실패 (${response.status})`);
            }
          } catch (error) {
            if (attempt === 2) throw error;
          }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        }
        throw new Error("파일 조각 전송에 실패했습니다.");
      }));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }
    // 등록 재시도에서도 같은 키를 사용해 중복 문서를 만들지 않는다.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completed = await apiFetch(`${endpoint}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ ticket: upload.ticket })
        });
        if (completed.status >= 500 && attempt < 2) continue;
        return await parseJsonOrThrow<DocumentUploadResponse>(completed, ERROR_MESSAGES.uploadFailed);
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    throw new Error(ERROR_MESSAGES.uploadFailed);
  } catch (error) {
    controller.abort();
    // 실패한 미완성 파트를 회수한다. 탭 종료 등 실패 시 S3 lifecycle이 나머지를 정리한다.
    await apiFetch(`${endpoint}/abort`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: upload.ticket })
    }).catch(() => undefined);
    throw error;
  }
}
