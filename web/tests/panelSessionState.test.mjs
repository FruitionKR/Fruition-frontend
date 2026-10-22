import assert from "node:assert/strict";
import test from "node:test";
import { emptyPanelSessionState, panelSessionStorageKey, parsePanelSessionState, selectPanelSession, panelDraftStorageKey } from "../src/features/agent-chat/lib/panelSessionState.ts";

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
