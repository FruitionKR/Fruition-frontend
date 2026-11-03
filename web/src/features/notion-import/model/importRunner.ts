/**
 * 가져오기 계획을 서버에 쓴다. 폴더(위에서 아래로) → 문서 생성·PDF 업로드(ID 확보) → 링크·이미지를 채운 본문 저장 순서다.
 * PDF는 원본으로만 올린다. Markdown 변환은 가져오기가 끝난 뒤 사용자가 고를 때만 요청한다(useNotionImport).
 * 결과는 RunState에 쌓이므로 같은 state로 다시 부르면 실패한 항목만 다시 보낸다(멱등 키가 같아 중복 생성되지 않는다).
 */
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import { createConcurrencyLimiter } from "@/shared/lib/concurrencyLimit";
import { planAttachmentBatches } from "@/shared/lib/markdown-import/attachmentBatches";
import { renderImages, renderLinks } from "../lib/notionLinks";
import type { ImportPlan, PlanDocument, PlanPdf } from "../lib/notionPlan";

/** 문서 생성·본문 저장 동시 요청 수. 문서 업로드와 같이 2개씩 보낸다. */
export const IMPORT_CONCURRENCY = 2;

/** 이 오류가 나면 남은 요청도 같은 이유로 실패하므로 멈춘다. */
const FATAL_CODES = new Set(["STORAGE_QUOTA_EXCEEDED", "IMPORT_INVALID", "IMPORT_NOT_FOUND"]);

const IMPORT_ERROR_MESSAGES: Record<string, string> = {
  IMPORT_INVALID: "가져오기 세션이 끝났거나 올바르지 않아요. 처음부터 다시 가져와 주세요.",
  IMPORT_NOT_FOUND: "가져오기 기록을 찾을 수 없어요. 처음부터 다시 가져와 주세요.",
  INVALID_REQUEST: "요청 내용이 올바르지 않아 서버가 받지 않았어요.",
  FILE_TOO_LARGE: "파일이 너무 커서 올리지 못했어요. PDF는 100MB 이하만 가져올 수 있어요."
};

export function importErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code && IMPORT_ERROR_MESSAGES[error.code]) return IMPORT_ERROR_MESSAGES[error.code];
  return getErrorMessage(error, fallback);
}

export type ImportWriterPort = {
  createFolder(name: string, parentFolderId: string | null, idempotencyKey: string): Promise<{ id: string }>;
  createDocument(displayName: string, markdown: string, folderId: string | null, idempotencyKey: string): Promise<{ id: string; current_version?: number }>;
  saveContent(
    documentId: string,
    markdown: string,
    baseVersion: number,
    attachments: { id: string; file: File }[],
    writeId: string
  ): Promise<{ current_version: number; attachments?: { attachment_id: string; content_path: string }[] }>;
  uploadPdf(file: File, folderId: string | null, idempotencyKey: string): Promise<{ id: string }>;
};

export type ImportFailure = { key: string; label: string; message: string };

export type RunState = {
  folderIds: Map<string, string>;
  documents: Map<string, { id: string; version: number }>;
  /** 본문까지 끝난 문서 key */
  contentDone: Set<string>;
  /** 문서 key → 이미지 순번 → 서버 경로. 나눠 저장하다 실패해도 앞 묶음은 다시 보내지 않는다. */
  savedImages: Map<string, Map<number, string>>;
  failures: Map<string, ImportFailure>;
};

export function createRunState(): RunState {
  return { folderIds: new Map(), documents: new Map(), contentDone: new Set(), savedImages: new Map(), failures: new Map() };
}

export type ImportProgress = { done: number; total: number; phase: "folders" | "documents" | "content" };

/** SHA-256 hex. 멱등 키·쓰기 ID·첨부 UUID를 import_id와 zip 경로에서 결정적으로 만든다. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function importKey(importId: string, path: string, purpose: string): Promise<string> {
  return sha256Hex(`${importId}\u0000${purpose}\u0000${path}`).then((hex) => `notion-${hex}`);
}

/** 해시로 만든 UUID 모양 문자열(버전 4·variant 비트를 맞춘다). attachment://<uuid> 계약에 쓴다. */
export async function deterministicUuid(seed: string): Promise<string> {
  const hex = (await sha256Hex(seed)).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/** 링크·이미지를 채워야 해서 생성 뒤 본문을 한 번 더 저장하는 문서인지 */
export function needsContentPass(document: PlanDocument): boolean {
  return document.links.length > 0 || document.images.length > 0;
}

/** 링크·이미지가 없는 문서는 처음 만들 때 최종 본문을 넣는다. 나머지는 빈 본문으로 만들어 ID부터 받는다. */
function initialMarkdown(document: PlanDocument): string {
  return needsContentPass(document) ? "" : document.markdown;
}

export function countImportSteps(plan: ImportPlan): number {
  return plan.folders.length + plan.documents.length + plan.documents.filter(needsContentPass).length + plan.pdfs.length;
}

export type RunOptions = {
  importId: string;
  writer: ImportWriterPort;
  state: RunState;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
};

export type RunResult = {
  /** 남은 요청을 멈춘 치명적 오류(저장 용량 초과 등). 없으면 null */
  fatalMessage: string | null;
  cancelled: boolean;
};

class StopImport extends Error {}

/** 모든 작업이 끝날 때까지 기다린 뒤, 멈춤이 아닌 오류가 있으면 던지고 멈춤만 있으면 StopImport를 던진다. */
async function settleAll(tasks: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && !(result.reason instanceof StopImport));
  if (failure) throw failure.reason;
  if (results.some((result) => result.status === "rejected")) throw new StopImport();
}

/** 계획을 실행한다. 이미 끝난 항목은 state를 보고 건너뛴다. */
export async function runImport(plan: ImportPlan, { importId, writer, state, signal, onProgress }: RunOptions): Promise<RunResult> {
  const total = countImportSteps(plan);
  let fatalMessage: string | null = null;
  const doneCount = () => state.folderIds.size + state.documents.size + state.contentDone.size;
  const report = (phase: ImportProgress["phase"]) => onProgress?.({ done: Math.min(total, doneCount()), total, phase });
  const folderNames = new Map(plan.folders.map((folder) => [folder.key, folder.name]));
  const isStopped = () => Boolean(signal?.aborted) || fatalMessage !== null;

  async function attempt(key: string, label: string, fallback: string, action: () => Promise<void>) {
    if (isStopped()) throw new StopImport();
    try {
      await action();
      state.failures.delete(key);
    } catch (error) {
      if (signal?.aborted) throw new StopImport();
      const message = importErrorMessage(error, fallback);
      state.failures.set(key, { key, label, message });
      if (error instanceof ApiError && error.code && FATAL_CODES.has(error.code)) {
        fatalMessage = message;
        throw new StopImport();
      }
    }
  }

  function parentId(folderKey: string | null): string | null | undefined {
    return folderKey === null ? null : state.folderIds.get(folderKey);
  }

  async function createDocument(document: PlanDocument) {
    if (state.documents.has(document.key)) return;
    const folderId = parentId(document.folderKey);
    if (folderId === undefined) {
      state.failures.set(document.key, { key: document.key, label: document.name, message: "상위 폴더를 만들지 못해 건너뛰었어요." });
      return;
    }
    await attempt(document.key, document.name, "문서를 만들지 못했어요.", async () => {
      const created = await writer.createDocument(document.name, initialMarkdown(document), folderId, await importKey(importId, document.key, "document"));
      state.documents.set(document.key, { id: created.id, version: created.current_version ?? 1 });
      if (!needsContentPass(document)) state.contentDone.add(document.key);
    });
    report("documents");
  }

  /** PDF 원본을 올린다(본문은 이때 푼다). 변환은 하지 않는다. */
  async function uploadPdf(pdf: PlanPdf) {
    if (state.documents.has(pdf.key)) return;
    const folderId = parentId(pdf.folderKey);
    if (folderId === undefined) {
      state.failures.set(pdf.key, { key: pdf.key, label: pdf.name, message: "상위 폴더를 만들지 못해 건너뛰었어요." });
      return;
    }
    await attempt(pdf.key, pdf.name, "PDF를 올리지 못했어요.", async () => {
      const file = new File([pdf.read() as Uint8Array<ArrayBuffer>], pdf.name, { type: "application/pdf" });
      const created = await writer.uploadPdf(file, folderId, await importKey(importId, pdf.key, "pdf"));
      state.documents.set(pdf.key, { id: created.id, version: 1 });
    });
    report("documents");
  }

  async function saveDocumentContent(document: PlanDocument) {
    const created = state.documents.get(document.key);
    if (!created || state.contentDone.has(document.key)) return;
    await attempt(`${document.key}#content`, document.name, "문서 본문을 저장하지 못했어요.", async () => {
      const withLinks = renderLinks(document.markdown, document.links, (key) => state.documents.get(key)?.id);
      const saved = state.savedImages.get(document.key) ?? new Map<number, string>();
      state.savedImages.set(document.key, saved);
      const pending = document.images.map((image, index) => ({ image, index })).filter(({ index }) => !saved.has(index));
      const batches = planAttachmentBatches(pending.map(({ image }) => image.size), { markdownBytes: document.bytes });
      if (batches.length === 0) batches.push([]);
      for (const batch of batches) {
        if (isStopped()) throw new StopImport();
        const sending = await Promise.all(batch.map(async (position) => {
          const { image, index } = pending[position];
          const id = await deterministicUuid(`${importId}\u0000${document.key}\u0000${image.path}`);
          return { index, id, file: new File([image.read() as Uint8Array<ArrayBuffer>], image.fileName, { type: image.mime }) };
        }));
        const idByIndex = new Map(sending.map(({ index, id }) => [index, id]));
        const markdown = renderImages(withLinks, document.images, (index) => saved.get(index) ?? (idByIndex.has(index) ? `attachment://${idByIndex.get(index)}` : null));
        const writeId = await importKey(importId, `${document.key}#${created.version}`, "content");
        const response = await writer.saveContent(created.id, markdown, created.version, sending.map(({ id, file }) => ({ id, file })), writeId);
        created.version = response.current_version;
        const pathById = new Map((response.attachments ?? []).map((entry) => [entry.attachment_id.toLowerCase(), entry.content_path]));
        for (const { index, id } of sending) {
          const path = pathById.get(id);
          if (path) saved.set(index, path);
        }
      }
      state.contentDone.add(document.key);
    });
    report("content");
  }

  try {
    // 1) 폴더를 위에서 아래로
    for (const folder of plan.folders) {
      if (!state.folderIds.has(folder.key)) {
        const parent = parentId(folder.parentKey);
        if (parent === undefined) {
          state.failures.set(folder.key, { key: folder.key, label: folder.name, message: `상위 폴더 '${folderNames.get(folder.parentKey ?? "") ?? ""}'를 만들지 못해 건너뛰었어요.` });
          continue;
        }
        await attempt(folder.key, folder.name, "폴더를 만들지 못했어요.", async () => {
          const created = await writer.createFolder(folder.name, parent, await importKey(importId, folder.key, "folder"));
          state.folderIds.set(folder.key, created.id);
        });
        report("folders");
      }
    }

    // 2) 문서 생성·PDF 업로드(합쳐서 동시 2개). 본문의 PDF 링크를 채우려면 PDF 문서 ID가 먼저 있어야 한다.
    const limit = createConcurrencyLimiter(IMPORT_CONCURRENCY);
    await settleAll([
      ...plan.documents.map((document) => limit(() => createDocument(document))),
      ...plan.pdfs.map((pdf) => limit(() => uploadPdf(pdf)))
    ]);

    // 3) 링크·이미지를 채운 본문 저장(동시 2개)
    await settleAll(plan.documents.filter(needsContentPass).map((document) => limit(() => saveDocumentContent(document))));
  } catch (error) {
    if (!(error instanceof StopImport)) throw error;
  }
  report("content");
  return { fatalMessage, cancelled: Boolean(signal?.aborted) };
}

/** complete 요청에 보낼 개수. 본문 저장까지 실패한 문서도 서버에는 만들어졌으므로 created에 넣는다. */
export function summarizeRun(plan: ImportPlan, state: RunState) {
  const created = state.documents.size;
  const createdTables = plan.documents.filter((document) => document.kind === "table" && state.documents.has(document.key)).length;
  const createdPdfs = plan.pdfs.filter((pdf) => state.documents.has(pdf.key)).length;
  return {
    created,
    /** 화면 표시용: 미리보기처럼 문서·표·PDF를 나눠 센다 */
    createdPages: created - createdTables - createdPdfs,
    createdTables,
    createdPdfs,
    failed: plan.documents.length + plan.pdfs.length - created + plan.folders.filter((folder) => !state.folderIds.has(folder.key)).length,
    skipped: plan.skipped.length,
    documentIds: [...state.documents.values()].map(({ id }) => id)
  };
}
