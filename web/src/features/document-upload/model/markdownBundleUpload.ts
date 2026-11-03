/**
 * Markdown 문서 하나를 그 그림과 함께 올린다. .md를 먼저 올려 문서를 만들고, 그림은 본문 저장(PUT content)의 첨부로
 * 나눠 보낸다(저장 한 번에 20개·첨부 하나 10MB·요청 100MB). 보낸 그림의 본문 주소는 서버가 준 경로로 바꾼다.
 * 저장 용량(5GB)·형식 오류는 서버가 판단하고, 그 오류로 멈춘 뒤 남은 그림 수를 돌려준다.
 */
import { ATTACHMENT_MAX_BYTES, planAttachmentBatches } from "@/shared/lib/markdown-import/attachmentBatches";
import { sniffImageMime, type ImageMime } from "@/shared/lib/markdown-import/imageSniff";
import { pathKey, rewriteImageRefs, type BundleDocument, type BundleFile } from "../lib/markdownBundle";

export type BundleUploadWriter = {
  uploadMarkdown(file: File): Promise<{ id: string; current_version?: number }>;
  saveContent(
    documentId: string,
    markdown: string,
    baseVersion: number,
    attachments: { id: string; file: File }[]
  ): Promise<{ content_version: number; attachments: { attachment_id: string; content_path: string }[] }>;
};

export type BundleUploadResult<T> = {
  created: T;
  /** 본문에 넣은 그림 수 */
  attached: number;
  /** 형식이 아니거나 10MB를 넘어 넣지 않은 그림 경로 */
  rejected: string[];
  /** 저장이 실패해 넣지 못한 그림 수와 그 오류. 문서는 만들어진 채로 남는다. */
  failed: { count: number; error: unknown } | null;
};

type ReadyImage = { key: string; file: File; size: number };

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || "image";
}

async function prepareImage(image: BundleFile): Promise<{ file: File; mime: ImageMime } | null> {
  if (image.size > ATTACHMENT_MAX_BYTES) return null;
  const bytes = await image.read();
  const mime = sniffImageMime(bytes.subarray(0, 16));
  return mime ? { file: new File([bytes as Uint8Array<ArrayBuffer>], fileName(image.path), { type: mime }), mime } : null;
}

export async function uploadMarkdownBundleDocument<T extends { id: string; current_version?: number }>(
  document: BundleDocument,
  writer: Omit<BundleUploadWriter, "uploadMarkdown"> & { uploadMarkdown(file: File): Promise<T> },
  newId: () => string = () => crypto.randomUUID()
): Promise<BundleUploadResult<T>> {
  // 같은 파일을 여러 주소로 가리켜도 한 번만 보낸다.
  const ready: ReadyImage[] = [];
  const rejected: string[] = [];
  const keyByRef = new Map<string, string>();
  const seen = new Map<BundleFile, string | null>();
  for (const { ref, file } of document.images) {
    if (!seen.has(file)) {
      const prepared = await prepareImage(file);
      const key = prepared ? pathKey(file.path) : null;
      seen.set(file, key);
      if (prepared && key) ready.push({ key, file: prepared.file, size: file.size });
      else rejected.push(ref);
    }
    const key = seen.get(file);
    if (key) keyByRef.set(pathKey(ref), key);
  }

  const markdownFile = new File([document.markdown], fileName(document.file.path), { type: "text/markdown" });
  const created = await writer.uploadMarkdown(markdownFile);
  let version = created.current_version ?? 1;
  const saved = new Map<string, string>();
  const markdownBytes = new TextEncoder().encode(document.markdown).length;
  const batches = planAttachmentBatches(ready.map((image) => image.size), { markdownBytes });
  for (const [batchIndex, batch] of batches.entries()) {
    const sending = batch.map((position) => ({ ...ready[position], id: newId() }));
    const idByKey = new Map(sending.map(({ key, id }) => [key, id]));
    const markdown = rewriteImageRefs(document.markdown, document.file.path, (ref) => {
      const key = keyByRef.get(pathKey(ref));
      if (!key) return null;
      return saved.get(key) ?? (idByKey.has(key) ? `attachment://${idByKey.get(key)}` : null);
    });
    try {
      const response = await writer.saveContent(created.id, markdown, version, sending.map(({ id, file }) => ({ id, file })));
      version = response.content_version;
      const pathById = new Map(response.attachments.map((entry) => [entry.attachment_id.toLowerCase(), entry.content_path]));
      for (const { key, id } of sending) {
        const path = pathById.get(id.toLowerCase());
        if (path) saved.set(key, path);
      }
    } catch (error) {
      const remaining = batches.slice(batchIndex).reduce((sum, rest) => sum + rest.length, 0);
      return { created, attached: saved.size, rejected, failed: { count: remaining, error } };
    }
  }
  return { created, attached: saved.size, rejected, failed: null };
}
