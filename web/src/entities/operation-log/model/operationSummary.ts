import type koWorkspace from "@/shared/i18n/messages/ko/workspace.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";
import type { OperationLogItem } from "./operationLog";

export type OperationSummaryTranslate = MessageTranslate<typeof koWorkspace.logMessages.summary>;
type SummaryKey = Parameters<OperationSummaryTranslate>[0];
type SummaryItem = Pick<OperationLogItem, "operation_type" | "status" | "summary" | "changed_resource_count">;
type LocalSummary = { key: SummaryKey; values?: Record<string, number> };

/** 서버(document LintOperationStarter)가 lint 작업에 넣는 대상 이름. 문서 이름이 아니라 로그 설명에서 뺀다. */
export const LINT_SERVER_DISPLAY_NAME = "위키 다듬기";

/** 서버가 lint 작업에 붙인 한국어 작업 이름(LINT_SERVER_DISPLAY_NAME)인가. 문서 이름처럼 보이지 않게 뺄 때 쓴다. */
export function isServerLintDisplayName(operationType: string | undefined, name: string | null | undefined): boolean {
  return operationType === "lint" && name?.trim() === LINT_SERVER_DISPLAY_NAME;
}

// 서버 요약 중 필드로는 알 수 없는 숫자(버전·건수)나 같은 상태의 여러 문구를 가르는 데만 쓴다.
// document RestoreOperationLifecycle.finishDocument / RestoreRebuildApplier.resultSummary / AiTaskResultApplier(lint) /
// OperationFailureSummary.restoreFailure.
const RESTORE_DOCUMENT_PATTERN = /^버전 (\d+) 내용으로 되돌렸습니다\. 새 버전 (\d+)$/u;
const RESTORE_REBUILD_PATTERN = /^페이지 변경 (\d+)건 · 삭제 (\d+)건 · 링크 제거 (\d+)건 · 링크 복원 (\d+)건 · 실패 (\d+)건$/u;
const LINT_CHANGED_PATTERN = /^Wiki lint로 페이지 (\d+)개를 변경했습니다\.$/u;
const RESTORE_FAILED_TEXT = "되돌리기에 실패했습니다.";
const RESTORE_CONFLICT_LATER_TEXT = "뒤에 실행한 작업과 충돌해 되돌리지 않았습니다. 뒤 작업부터 되돌려 주세요.";

function restoreSummary(status: string, summary: string): LocalSummary | null {
  if (status === "succeeded") {
    const document = RESTORE_DOCUMENT_PATTERN.exec(summary);
    if (document) return { key: "restoreDocument", values: { from: Number(document[1]), to: Number(document[2]) } };
  }
  if (status === "succeeded" || status === "partially_succeeded") {
    const rebuild = RESTORE_REBUILD_PATTERN.exec(summary);
    if (rebuild) {
      const [changed, deleted, linksRemoved, linksRestored, failed] = rebuild.slice(1).map(Number);
      return { key: "restoreRebuild", values: { changed, deleted, linksRemoved, linksRestored, failed } };
    }
  }
  if (status === "partially_succeeded") return { key: "restorePartial" };
  // 실패 문구는 두 가지라 상태만으로 고르지 않는다.
  if (status === "failed" && summary === RESTORE_FAILED_TEXT) return { key: "restoreFailed" };
  if (status === "failed" && summary === RESTORE_CONFLICT_LATER_TEXT) return { key: "restoreConflictLater" };
  if (status === "conflict") return { key: "restoreStale" };
  return null;
}

function lintSummary(status: string, summary: string): LocalSummary | null {
  if (status === "succeeded") {
    const changed = LINT_CHANGED_PATTERN.exec(summary);
    return changed ? { key: "lintSucceeded", values: { count: Number(changed[1]) } } : null;
  }
  if (status === "partially_succeeded") return { key: "lintPartial" };
  if (status === "failed") return { key: "lintFailed" };
  return null;
}

/** 작업 종류·상태·변경 건수로 서버 요약에 해당하는 문구를 고른다. 모르는 조합이면 null. */
function localSummaryOf({ operation_type: type, status, changed_resource_count: changedCount }: SummaryItem, text: string): LocalSummary | null {
  switch (type) {
    case "ingest":
      if (status === "succeeded") return { key: "ingestSucceeded" };
      if (status === "partially_succeeded") return { key: "ingestPartial" };
      if (status === "failed") return { key: "ingestFailed" };
      return null;
    case "lint":
      return lintSummary(status, text);
    case "restore":
      return restoreSummary(status, text);
    case "document_edit":
      // document OperationRecorder: 반영하면 변경 1건, 결과가 현재 본문과 같으면 0건으로 남긴다.
      if (status === "succeeded") return { key: changedCount > 0 ? "documentEditApplied" : "documentEditUnchanged" };
      if (status === "partially_succeeded") return { key: "documentEditPartial" };
      if (status === "failed") return { key: "documentEditFailed" };
      if (status === "conflict") return { key: "documentEditConflict" };
      return null;
    case "wiki_edit":
      if (status === "succeeded") return { key: "wikiEditSucceeded" };
      if (status === "failed") return { key: "wikiEditFailed" };
      return null;
    default:
      return null;
  }
}

/**
 * 서버가 한국어로 저장한 작업 요약(ai_operation_logs.summary)을 지금 언어 문구로 바꾼다.
 * 서버가 요약을 남긴 작업만 바꾸고(요약이 없으면 그대로 null), 알 수 없는 종류·상태이거나
 * 숫자를 읽을 수 없는 요약은 서버 문구를 그대로 돌려준다. t를 넘기지 않으면 서버 문구를 쓴다.
 */
export function localizeOperationSummary(item: SummaryItem, t?: OperationSummaryTranslate): string | null {
  const text = item.summary?.trim();
  if (!text || !t) return text || null;
  const local = localSummaryOf(item, text);
  return local ? t(local.key, local.values) : text;
}
