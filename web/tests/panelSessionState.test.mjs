import assert from "node:assert/strict";
import test from "node:test";
import { emptyPanelSessionState, panelSessionStorageKey, parsePanelSessionState, selectPanelSession, panelDraftStorageKey, findReusableEmptySession, resolvePanelDraft } from "../src/features/agent-chat/lib/panelSessionState.ts";

test("채팅·작업은 서로 다른 세션을 선택하고 새로고침 뒤에도 선택을 복원한다", () => {
  let state = selectPanelSession(emptyPanelSessionState(), "chat", "chat-1");
  state = selectPanelSession(state, "work", "work-1");
  state = selectPanelSession(state, "chat", "chat-2");
  assert.deepEqual(parsePanelSessionState(JSON.stringify(state)).selected, { chat: "chat-2", work: "work-1" });
});

test("다른 탭 소유 세션으로 이동하거나 저장값으로 끼워 넣을 수 없다", () => {
  const state = selectPanelSession(emptyPanelSessionState(), "chat", "chat-1");
  assert.throws(() => selectPanelSession(state, "work", "chat-1"));
  const stored = parsePanelSessionState(JSON.stringify({ ...state, selected: { work: "chat-1" } }));
  assert.equal(stored.selected.work, null);
});

test("기존 통합 세션은 양쪽 탭에서 열람할 수 있고 새 탭별 선택은 독립적이다", () => {
  let state = selectPanelSession(emptyPanelSessionState(), "chat", "legacy-1", "legacy");
  state = selectPanelSession(state, "work", "legacy-1");
  state = selectPanelSession(state, "work", "work-1");
  assert.deepEqual(state.selected, { chat: "legacy-1", work: "work-1" });
  assert.equal(state.channels["legacy-1"], "legacy");
});

test("계정·워크스페이스·탭·세션마다 저장소 키가 다르다", () => {
  const scopes = [panelSessionStorageKey("u1", "w1"), panelSessionStorageKey("u2", "w1"), panelSessionStorageKey("u1", "w2")];
  const keys = scopes.flatMap(scope => [panelDraftStorageKey(scope, "chat", "s1"), panelDraftStorageKey(scope, "work", "s1"), panelDraftStorageKey(scope, "chat", "s2")]);
  assert.equal(new Set(keys).size, 9);
  assert.notEqual(panelSessionStorageKey("u:a", "w"), panelSessionStorageKey("u", "a:w"));
});

test("손상된 저장값과 알 수 없는 탭은 빈 상태로 안전하게 읽는다", () => {
  for (const raw of [null, "{", "null", "1", "[]"]) assert.deepEqual(parsePanelSessionState(raw), emptyPanelSessionState());
  const state = parsePanelSessionState('{"channels":{"bad":"other","ok":"work"},"selected":{"chat":"bad","work":"ok"}}');
  assert.deepEqual(state.channels, { ok: "work" });
  assert.deepEqual(state.selected, { chat: null, work: "ok" });
});

test("메시지 없는 세션은 다른 탭이 보고 있지 않으면 재사용한다", () => {
  const sessions = [
    { id: "used", isEmpty: false },
    { id: "chat-empty", isEmpty: true },
    { id: "spare", isEmpty: true }
  ];
  const selected = { chat: "chat-empty", work: null };
  assert.equal(findReusableEmptySession(sessions, selected, "work")?.id, "spare");
});

test("현재 탭이 이미 보고 있는 빈 세션은 새 채팅에 그대로 쓴다", () => {
  const sessions = [{ id: "used", isEmpty: false }, { id: "mine", isEmpty: true }];
  assert.equal(findReusableEmptySession(sessions, { chat: "mine", work: null }, "chat")?.id, "mine");
});

test("재사용할 빈 세션이 없으면 null이다", () => {
  const sessions = [{ id: "used", isEmpty: false }, { id: "other-tab", isEmpty: true }];
  assert.equal(findReusableEmptySession(sessions, { chat: "other-tab", work: null }, "work"), null);
});

test("저장된 선택이 없으면 빈 세션보다 내용이 있는 세션을 먼저 연다", async () => {
  const { pickInitialSession } = await import("../src/features/agent-chat/lib/panelSessionState.ts");
  const empty = { id: "new", channel: "chat", isEmpty: true };
  const filled = { id: "old", channel: "chat", isEmpty: false };
  const work = { id: "work", channel: "work", isEmpty: false };
  assert.equal(pickInitialSession([empty, work, filled], "chat"), filled);
  assert.equal(pickInitialSession([empty, work], "chat"), empty);
  assert.equal(pickInitialSession([work], "chat"), null);
});

test("저장소에서 읽은 초안은 복원으로, 이 키로 입력한 값은 입력으로 본다", () => {
  const read = () => "/";
  // 새로 고침·세션 전환 직후: 이 키로 입력한 적이 없어 저장값을 쓴다.
  assert.deepEqual(resolvePanelDraft({ key: null, value: "" }, "k", read), { value: "/", isRestored: true });
  assert.deepEqual(resolvePanelDraft({ key: "다른 키", value: "x" }, "k", read), { value: "/", isRestored: true });
  // 입력하면 복원이 아니다. 복원된 "/"를 지우고 다시 쳐도 그렇다.
  assert.deepEqual(resolvePanelDraft({ key: "k", value: "/" }, "k", read), { value: "/", isRestored: false });
  assert.deepEqual(resolvePanelDraft({ key: "k", value: "" }, "k", read), { value: "", isRestored: false });
});
