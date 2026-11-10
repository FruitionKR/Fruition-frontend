import type { DocumentItemResponse } from "@/entities/document/model/document";
import { findServerTreeItem, type ServerTreeItem } from "@/entities/tree/model/serverTree";
import type { TreeItem } from "@/entities/tree/model/tree";
import { ApiError } from "@/shared/lib/apiErrors";

export type UploadBatchProgress = { total: number; completed: number; succeeded: number; failed: number };

export type UploadOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * 업로드 묶음을 실행한다. 항목을 모두 한꺼번에 넘기고(동시 개수·순서는 uploadDocumentFile의 대기열이 정한다),
 * 하나가 끝날 때마다 진행 상황을 알린다. results는 항목 순서대로(실패는 null), failures는 실패한 항목과 그 오류만 담는다.
 * 다시 올리기는 failures의 항목만 다시 넘긴다.
 */
export async function runUploadBatch<E, R>(
  entries: readonly E[],
  run: (entry: E) => Promise<UploadOutcome<R>>,
  onProgress?: (progress: UploadBatchProgress) => void
): Promise<{ results: (R | null)[]; failures: { entry: E; error: unknown }[]; progress: UploadBatchProgress }> {
  let progress: UploadBatchProgress = { total: entries.length, completed: 0, succeeded: 0, failed: 0 };
  const outcomes = await Promise.all(entries.map((entry) => run(entry).then((outcome) => {
    progress = {
      ...progress,
      completed: progress.completed + 1,
      succeeded: progress.succeeded + (outcome.ok ? 1 : 0),
      failed: progress.failed + (outcome.ok ? 0 : 1)
    };
    onProgress?.(progress);
    return outcome;
  })));
  return {
    results: outcomes.map((outcome) => (outcome.ok ? outcome.value : null)),
    failures: outcomes.flatMap((outcome, index) => (outcome.ok ? [] : [{ entry: entries[index], error: outcome.error }])),
    progress
  };
}

/**
 * 서버 응답을 받지 못했거나(네트워크·시간 초과) 5xx로 끝나 서버에 문서가 만들어졌는지 알 수 없는 실패인지.
 * 이런 실패를 다시 올리기 전에는 서버 트리를 확인해 이미 만들어진 문서를 다시 만들지 않는다(planUploadAdoptions).
 */
export function isAmbiguousUploadFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** 트리에 이미 보이는 서버 문서 id. 업로드를 시작할 때 찍어 두고, 그 뒤에 생긴 문서를 가려낸다. */
export function documentIdsInTree(items: readonly TreeItem[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly TreeItem[]) => nodes.forEach((node) => {
    if (node.documentId) ids.add(node.documentId);
    walk(node.children ?? []);
  });
  walk(items);
  return ids;
}

const normalizeName = (name: string) => name.trim().normalize("NFC").toLowerCase();

/** 서버는 같은 폴더에 같은 이름이 있으면 `이름 (2).md`처럼 번호를 붙여 저장한다. */
function isSameOrNumberedName(candidate: string, filename: string): boolean {
  const name = normalizeName(filename);
  const target = normalizeName(candidate);
  if (target === name) return true;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  if (!target.startsWith(`${stem} (`) || !target.endsWith(`)${extension}`)) return false;
  return /^\d+$/.test(target.slice(stem.length + 2, target.length - extension.length - 1));
}

/** 서버 시각(uploaded_at)과 브라우저 시각의 차이를 감안해, 시도 시작보다 이만큼 앞선 문서까지 그 시도의 결과일 수 있다고 본다. */
export const ADOPTION_CLOCK_SKEW_MS = 2 * 60_000;

/** 결과를 알 수 없이 실패한 일반 파일 업로드 하나(묶음 문서는 그림 첨부가 뒤따라야 해 넣지 않는다). */
export type AdoptionCandidate = {
  key: string;
  /** 올린 서버 폴더. null이면 최상위 */
  folderId: string | null;
  filename: string;
  size: number;
  /** 브라우저가 알려 준 MIME. 비어 있으면 비교하지 않는다. */
  mimeType: string;
  /** 그 시도를 시작할 때 트리에 있던 문서 id */
  knownDocumentIds: ReadonlySet<string>;
  /** 그 시도를 시작한 시각(ms) */
  startedAt: number;
};

const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

function matchesCandidate(item: ServerTreeItem, candidate: AdoptionCandidate, excluded: ReadonlySet<string>): boolean {
  const document = item.document;
  if (item.type !== "document" || !document) return false;
  if (candidate.knownDocumentIds.has(item.id) || excluded.has(item.id)) return false;
  if (!isSameOrNumberedName(item.name, candidate.filename) || document.byte_size !== candidate.size) return false;
  if (candidate.mimeType && document.mime_type && baseMime(candidate.mimeType) !== baseMime(document.mime_type)) return false;
  const uploadedAt = Date.parse(document.uploaded_at);
  return Number.isFinite(uploadedAt) && uploadedAt >= candidate.startedAt - ADOPTION_CLOCK_SKEW_MS;
}

/**
 * 다시 올리기 전에, 결과를 알 수 없이 실패한 업로드가 사실 서버에 만들어졌는지 찾는다. 새로 받은 서버 트리(items)에서
 * 올릴 폴더 바로 아래, 그 시도 이후 생긴(시도 전 트리에 없고 uploaded_at이 시작 이후) 문서 중
 * 이름이 같거나 서버 번호 규칙에 맞고 크기(가능하면 MIME)까지 같은 것만 본다. excludedDocumentIds는 이 페이지에서
 * 이미 업로드 결과로 받은 문서(같은 묶음의 성공한 `a (2).md` 등)다.
 * 후보와 문서가 서로 하나씩만 짝지어질 때만 채택한다. 하나로 특정되지 않으면 채택하지 않고 다시 보낸다
 * (중복 생성 가능성은 남지만 다른 문서를 결과로 잘못 잡는 것보다 낫다).
 */
export function planUploadAdoptions(
  items: ServerTreeItem[],
  candidates: readonly AdoptionCandidate[],
  excludedDocumentIds: ReadonlySet<string>
): Map<string, DocumentItemResponse> {
  const matches = candidates.map((candidate) => {
    const siblings = candidate.folderId === null ? items : findServerTreeItem(items, candidate.folderId)?.children ?? [];
    return { candidate, documents: siblings.filter((item) => matchesCandidate(item, candidate, excludedDocumentIds)) };
  });
  const claims = new Map<string, number>();
  matches.forEach(({ documents }) => documents.forEach((item) => claims.set(item.id, (claims.get(item.id) ?? 0) + 1)));
  const plan = new Map<string, DocumentItemResponse>();
  matches.forEach(({ candidate, documents }) => {
    const [only] = documents;
    if (documents.length === 1 && claims.get(only.id) === 1 && only.document) plan.set(candidate.key, only.document);
  });
  return plan;
}
