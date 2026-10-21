// 알림 카드 스택으로 알림을 보내는 전역 pub/sub.
// 알림 카드는 DocumentProcessingNotifications가 렌더링하므로,
// 다른 feature(채팅 질의 등)는 이 버스로 발행만 한다.

import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { WorkspacePermission } from "@/shared/lib/workspacePermissions";

export type NoticePayload = {
  kind: "completed" | "failed" | "info";
  title: string;
  message: string;
  /** 있으면 취소/실행 2버튼 카드로 렌더한다 (Figma 673:3870). 자동 닫힘 없음. */
  action?: { label: string; onAction: () => void };
  /**
   * action 버튼에 필요한 워크스페이스 권한(위키 편입 제안이면 wiki.ingest). 카드가 떠 있는 동안 권한이 회수되면
   * 스택이 카드를 내려 눌러도 403이 나는 버튼을 남기지 않는다.
   */
  requiredPermission?: WorkspacePermission;
  /**
   * lint·restore 작업 알림. 해당 유형 알림 설정이 꺼져 있으면 표시하지 않고,
   * id가 있으면 같은 작업의 알림(직접 발행 + 로그 폴링)을 한 번만 표시한다.
   */
  operation?: { type: "lint" | "restore"; id?: string };
  /** 카드가 다루는 문서 id. 이 카드가 보이는 동안 같은 문서로 제안 카드를 또 띄우지 않는 데 쓴다. */
  subjectIds?: readonly string[];
  /**
   * 최신 문서 목록으로 카드 문구·대상을 다시 맞춘다(삭제·이름 변경·편입 시작 반영). null이면 다룰 문서가 없어 카드를 내린다.
   * 스택이 문서 목록이 바뀔 때마다 호출한다.
   */
  reconcile?: (documents: DocumentItemResponse[]) => Pick<NoticePayload, "message" | "subjectIds"> | null;
};

type NoticeListener = (notice: NoticePayload) => void;

const listeners = new Set<NoticeListener>();
// 알림 스택이 지금 보여 주는 카드들의 subjectIds. 스택(useDocumentProcessingNotifications)이 갱신한다.
let visibleSubjectIds: ReadonlySet<string> = new Set();
// 문서별로 그 문서를 다루는 카드가 마지막으로 화면(대기열 포함)에서 사라진 시각. 리마인드 재발행 간격에 쓴다.
const subjectHiddenAt = new Map<string, number>();

export function publishNotice(notice: NoticePayload) {
  listeners.forEach((listener) => listener(notice));
}

export function subscribeNotices(listener: NoticeListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVisibleNoticeSubjects(ids: ReadonlySet<string>, now = Date.now()) {
  visibleSubjectIds.forEach((id) => {
    if (!ids.has(id)) subjectHiddenAt.set(id, now);
  });
  visibleSubjectIds = ids;
}

/** 이 문서를 다루는 카드가 지금 화면에 있는가. */
export function isNoticeSubjectVisible(id: string) {
  return visibleSubjectIds.has(id);
}

/** 이 문서를 다루는 카드가 마지막으로 사라진 시각. 카드가 뜬 적이 없으면 undefined. */
export function noticeSubjectHiddenAt(id: string): number | undefined {
  return subjectHiddenAt.get(id);
}
