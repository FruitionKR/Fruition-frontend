// 알림 카드 스택으로 알림을 보내는 전역 pub/sub.
// 알림 카드는 DocumentProcessingNotifications가 렌더링하므로,
// 다른 feature(채팅 질의 등)는 이 버스로 발행만 한다.

export type NoticePayload = {
  kind: "completed" | "failed" | "info";
  title: string;
  message: string;
  /** 있으면 취소/실행 2버튼 카드로 렌더한다 (Figma 673:3870). 자동 닫힘 없음. */
  action?: { label: string; onAction: () => void };
  /**
   * lint·restore 작업 알림. 해당 유형 알림 설정이 꺼져 있으면 표시하지 않고,
   * id가 있으면 같은 작업의 알림(직접 발행 + 로그 폴링)을 한 번만 표시한다.
   */
  operation?: { type: "lint" | "restore"; id?: string };
  /** 카드가 다루는 문서 id. 이 카드가 보이는 동안 같은 문서로 제안 카드를 또 띄우지 않는 데 쓴다. */
  subjectIds?: readonly string[];
};

type NoticeListener = (notice: NoticePayload) => void;

const listeners = new Set<NoticeListener>();
// 알림 스택이 지금 보여 주는 카드들의 subjectIds. 스택(useDocumentProcessingNotifications)이 갱신한다.
let visibleSubjectIds: ReadonlySet<string> = new Set();

export function publishNotice(notice: NoticePayload) {
  listeners.forEach((listener) => listener(notice));
}

export function subscribeNotices(listener: NoticeListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVisibleNoticeSubjects(ids: ReadonlySet<string>) {
  visibleSubjectIds = ids;
}

/** 이 문서를 다루는 카드가 지금 화면에 있는가. */
export function isNoticeSubjectVisible(id: string) {
  return visibleSubjectIds.has(id);
}
