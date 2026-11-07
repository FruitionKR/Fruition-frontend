import type koWorkspace from "@/shared/i18n/messages/ko/workspace.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";
import type { OperationType } from "./operationLog";

/** 작업 유형 표시 문구. 로그 사이드바 항목과 상세 헤더가 함께 쓴다. */
export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  document_edit: "AI 편집 반영",
  ingest: "위키 편입",
  lint: "위키 최신화",
  restore: "롤백",
  wiki_edit: "위키 직접 편집"
};

/** Ingest는 작업 종류 대신 시작 시점의 문서 이름을 제목으로 쓴다. t(`useTranslations("workspace.logs.types")`)를 넘기면 지금 언어로 쓴다. */
export function formatOperationLogTitle(
  item: { operation_type: OperationType; target_display_name?: string | null },
  t?: MessageTranslate<typeof koWorkspace.logs.types>
): string {
  if (item.operation_type === "ingest" && item.target_display_name?.trim()) return item.target_display_name;
  return t ? t(item.operation_type) : OPERATION_TYPE_LABELS[item.operation_type];
}
