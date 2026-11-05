import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, CHAT_SESSION_LIMIT_MESSAGE, getErrorMessage, isChatSessionLimitError } from "../src/shared/lib/apiErrors.ts";

const SERVER_MESSAGE = "워크스페이스당 채팅 세션은 최대 10개까지 만들 수 있습니다: workspace_id=ws_123";

test("세션 한도 409는 내부 ID 없이 해결 방법을 안내한다", () => {
  const message = getErrorMessage(new ApiError(SERVER_MESSAGE, 409, "CHAT_SESSION_LIMIT_EXCEEDED"), "대화를 만들지 못했습니다.");
  assert.equal(message, CHAT_SESSION_LIMIT_MESSAGE);
  assert.doesNotMatch(message, /workspace_id|ws_/);
  assert.match(message, /지우면/);
});

test("세션 한도 판단은 문구가 아니라 서버 code로 한다", () => {
  assert.equal(isChatSessionLimitError(new ApiError(SERVER_MESSAGE, 409, "CHAT_SESSION_LIMIT_EXCEEDED")), true);
  assert.equal(isChatSessionLimitError(new ApiError(SERVER_MESSAGE, 409, "OTHER")), false);
  assert.equal(isChatSessionLimitError(new Error(SERVER_MESSAGE)), false);
});
