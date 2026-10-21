// 서버 자동 병합(merged·overwritten)과 구 서버 409 뒤 편집기에 보여 주는 안내 문구.
export const OVERWRITTEN_NOTICE_TITLE = "지금 내용으로 저장했어요";
export const OVERWRITTEN_NOTICE_MESSAGE =
  "다른 곳에서 바뀐 내용과 겹쳐 지금 내용으로 저장했어요.";

/** 자동 병합 이전 서버의 409를 두 번 연달아 받았을 때. 저장은 막지 않고 다음 편집·Cmd/Ctrl+S에서 다시 보낸다. */
export const LEGACY_CONFLICT_MESSAGE =
  "다른 곳에서 먼저 저장된 내용이 있어 이번 저장이 반영되지 않았어요. 계속 편집하거나 Cmd/Ctrl+S를 누르면 지금 내용으로 다시 저장해요.";
