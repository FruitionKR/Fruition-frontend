import type koWiki from "../../../shared/i18n/messages/ko/wiki.json";
import type { MessageTranslate } from "../../../shared/i18n/messageTranslate";
import type { OperationLogItem } from "../../../entities/operation-log/model/operationLog";

type LintProgressTranslate = MessageTranslate<typeof koWiki.lintProgress>;

/** t(`useTranslations("wiki.lintProgress")`)를 넘기면 지금 언어로 쓴다. */
export function formatElapsedMinutes(startedAt: string, now = Date.now(), t?: LintProgressTranslate): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
  return t ? t("elapsed", { minutes: elapsedMinutes }) : `${elapsedMinutes}분째 실행 중`;
}

/**
 * lint 진행 라벨.
 * 요청 직후에는 아직 로그가 안 보일 수 있어, 로컬 요청 상태만으로도 진행 중을 표시한다.
 */
export function formatLintProgressLabel(
  log: OperationLogItem | null,
  isRequested: boolean,
  now = Date.now(),
  t?: LintProgressTranslate
): string | null {
  if (!log && !isRequested) return null;
  if (!log) return t ? t("pending") : "위키 최신화 진행 중";
  const elapsed = formatElapsedMinutes(log.created_at, now, t);
  return t ? t("running", { elapsed }) : `위키 최신화 · ${elapsed}`;
}
