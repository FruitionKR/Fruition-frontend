import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, render } from "./asyncHookShim.mjs";

registerHooks({
  resolve: createResolver({
    "@/entities/user": new URL("./asyncHookShim.mjs", import.meta.url).href,
    "@/features/document-notifications": new URL("../src/features/document-notifications/model/noticeBus.ts", import.meta.url).href
  })
});

const { useChatThread } = await import("../src/features/agent-chat/model/useChatThread.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { buildAgentTurnRequest } = await import("../src/features/agent-chat/lib/agentTurn.ts");
const { chatTabMessages, classifySessionChannel, isChatTabQuestion } = await import("../src/features/agent-chat/lib/taskThread.ts");
const { asksFromDocuments, appendMovedQuestion, mergeMovedAttachments } = await import("../src/widgets/agent-panel/lib/composerDocuments.ts");
const { readTurnReferences, recordTurnReferences, turnReferenceStorageKey, writeTurnReferences } = await import("../src/features/agent-chat/lib/turnReferences.ts");

const pair = (id, assistant) => [
  { id: `${id}-u`, role: "user", content: "질문", status: "completed", pair_id: id, references: [] },
  { id: `${id}-a`, role: "assistant", content: "답", status: "completed", pair_id: id, references: [], ...assistant }
];
const context = {
  documentId: "doc_open",
  baseVersion: 3,
  editorSnapshot: { markdown: "# 열린 문서", target: { type: "whole_document", startLine: 1, endLine: 1 } }
};
const selectedModel = { provider: "openai", model: "gpt-6-luna" };

test("채팅 탭 문서 질문은 mode=chat이고 스킬을 쓰지 않으며 열린 문서·첨부를 근거로 싣는다", () => {
  const request = buildAgentTurnRequest("이 문서의 베타 공개일이 언제야?", context, {
    sessionId: "s1", selectedModel, selectedPairIds: [], mode: "chat", referenceDocumentIds: ["doc_1"]
  });
  assert.equal(request.mode, "chat");
  assert.equal(request.skill_mode, "off");
  assert.equal(request.documentId, "doc_open");
  assert.deepEqual(request.reference_document_ids, ["doc_1"]);
});

test("작업 탭 요청은 그대로 mode=task이고 스킬 설정을 싣지 않는다", () => {
  const request = buildAgentTurnRequest("오타 고쳐 줘", context, { sessionId: "s1", selectedModel, selectedPairIds: [] });
  assert.equal(request.mode, "task");
  assert.equal("skill_mode" in request, false);
});

test("첨부나 내용 있는 열린 문서가 있으면 문서 질문, 없으면 지금처럼 위키 질의다", () => {
  assert.equal(asksFromDocuments(null, []), false);
  assert.equal(asksFromDocuments(null, ["doc_1"]), true);
  assert.equal(asksFromDocuments(context, []), true);
  assert.equal(asksFromDocuments({ ...context, editorSnapshot: { ...context.editorSnapshot, markdown: " \n" } }, []), false);
});

test("세션 분류: agent turn의 답변만 있으면 채팅이고, 질의와 섞여도 채팅이다", () => {
  assert.equal(classifySessionChannel(pair("p1", { run_id: "agent_1", action: "chat_answer" })), "chat");
  assert.equal(classifySessionChannel(pair("p1", { run_id: "agent_1", action: "conversation_reply" })), "chat");
  assert.equal(classifySessionChannel([...pair("p1", { run_id: "query_1" }), ...pair("p2", { run_id: "agent_2", action: "chat_answer" })]), "chat");
});

test("세션 분류: 작업 갈래가 있으면 그대로 작업·이전 통합 대화다", () => {
  assert.equal(classifySessionChannel(pair("p1", { run_id: "agent_1", action: "markdown_edit" })), "work");
  assert.equal(classifySessionChannel([...pair("p1", { run_id: "query_1" }), ...pair("p2", { run_id: "agent_2", action: "markdown_edit" })]), "legacy");
});

test("채팅 세션은 진행 중·실패·되묻기인 문서 질문도 채팅 탭에 남긴다", () => {
  const messages = [
    ...pair("p1", { run_id: "agent_1", status: "pending", content: "" }),
    ...pair("p2", { run_id: "agent_2", status: "failed" }),
    ...pair("p3", { run_id: "agent_3", action: "clarify" }),
    ...pair("p4", { run_id: "query_4" })
  ];
  assert.equal(chatTabMessages(messages, "chat").length, messages.length);
});

test("이전 통합 대화는 지금처럼 작업 문답을 채팅 탭에서 뺀다", () => {
  const messages = [...pair("p1", { run_id: "agent_1", action: "markdown_edit" }), ...pair("p2", { run_id: "query_2" })];
  assert.deepEqual(chatTabMessages(messages, "legacy").map((message) => message.pair_id), ["p2", "p2"]);
});

test("작업 탭이 돌려보낸 질문을 코드로 알아보고, 코드가 없는 옛 서버는 문구로 알아본다", () => {
  const item = { action: "clarify", clarifyReason: "chat_tab_question", answer: "채팅 탭에서 물어보세요." };
  assert.equal(isChatTabQuestion(item), true);
  assert.equal(isChatTabQuestion({ ...item, clarifyReason: null }), true);
  assert.equal(isChatTabQuestion({ ...item, clarifyReason: null, answer: "어느 문서를 고칠까요?" }), false);
  assert.equal(isChatTabQuestion({ ...item, clarifyReason: "attachment_target_required" }), false);
  assert.equal(isChatTabQuestion({ ...item, action: "markdown_edit" }), false);
});

test("옮기는 질문은 쓰던 초안을 지우지 않고 뒤에 붙이고, 다시 눌러도 겹치지 않는다", () => {
  assert.equal(appendMovedQuestion("", "베타 공개일이 언제야?"), "베타 공개일이 언제야?");
  assert.equal(appendMovedQuestion("쓰던 글", "베타 공개일이 언제야?"), "쓰던 글\n베타 공개일이 언제야?");
  assert.equal(appendMovedQuestion("베타 공개일이 언제야?", "베타 공개일이 언제야?"), "베타 공개일이 언제야?");
});

test("옮기는 첨부는 겹치지 않게 붙이고 한도를 넘은 수를 알려 준다", () => {
  const docs = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(mergeMovedAttachments([], docs.slice(0, 2), 3), { documents: docs.slice(0, 2), droppedCount: 0 });
  assert.deepEqual(mergeMovedAttachments([docs[0]], [docs[0], docs[1]], 3), { documents: docs.slice(0, 2), droppedCount: 0 });
  assert.deepEqual(mergeMovedAttachments(docs.slice(0, 2), docs.slice(2), 3), { documents: docs.slice(0, 3), droppedCount: 1 });
});

test("turn의 첨부를 브라우저에 적어 새로 고침 뒤에도 옮길 수 있다", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const key = turnReferenceStorageKey("ws_1");
  writeTurnReferences(storage, key, "turn_1", ["doc_1", "doc_2"]);
  writeTurnReferences(storage, key, "turn_2", []);
  assert.deepEqual(readTurnReferences(storage, key).get("turn_1"), ["doc_1", "doc_2"]);
  assert.equal(readTurnReferences(storage, key).has("turn_2"), false);
  store.set(key, "깨진 값");
  assert.equal(readTurnReferences(storage, key).size, 0);
  assert.deepEqual(recordTurnReferences(new Map(), "turn_3", ["doc_3"]).get("turn_3"), ["doc_3"]);
});

function questionServer(t) {
  browserEnv(t);
  saveAccessToken("test-access");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = { messages: [], cancels: [], messageRequests: 0 };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (/\/agent\/turn\/[^/]+\/cancel$/.test(path)) {
      server.cancels.push(path);
      assert.equal(init.method, "POST");
      return Response.json({ status: "cancel_requested" });
    }
    assert.match(path, /\/chat\/sessions\/[^/]+\/messages$/, `예상 밖 요청 ${path}`);
    server.messageRequests += 1;
    return Response.json({ messages: server.messages });
  });
  return server;
}

function renderThread() {
  const view = render(() => useChatThread("s1"));
  return { get thread() { return view.rerender(); }, unmount: view.unmount };
}

test("문서 질문을 보내면 진행 중으로 보이고, 끝나면 세션 메시지로 답을 보여 준다", async (t) => {
  const server = questionServer(t);
  const view = renderThread();
  await advance(t, 0);
  let finish;
  const started = view.thread.submitDocumentQuestion("베타 공개일이 언제야?", ({ onAccepted, onStage }) => {
    onAccepted("agent_1");
    onStage({ stage: "reading", message: "첨부한 문서를 읽고 있어요.", sequence: 1 });
    return new Promise((resolve) => { finish = resolve; });
  });
  await advance(t, 0);
  assert.equal(view.thread.isLoading, true);
  assert.equal(view.thread.activeTurn.question, "베타 공개일이 언제야?");
  assert.equal(view.thread.queryStages.length, 1);

  server.messages = pair("p1", { run_id: "agent_1", action: "chat_answer" });
  finish({ requestId: "agent_1", result: { action: "markdown_edit", edit: {} } });
  await advance(t, 0);
  assert.equal(await started, false);
  assert.equal(view.thread.isLoading, false);
  assert.equal(view.thread.activeTurn, null);
  assert.deepEqual(view.thread.messages.map((message) => message.id), ["p1-u", "p1-a"]);
  assert.equal(view.thread.animatedMessageId, "p1-a");
});

test("서버가 받기 전에 실패하면 true를 돌려 입력을 되돌리게 한다", async (t) => {
  questionServer(t);
  const view = renderThread();
  await advance(t, 0);

  const rejected = await view.thread.submitDocumentQuestion("질문", async () => { throw new Error("고른 문서 중 사용할 수 없는 문서가 있습니다."); });

  assert.equal(rejected, true);
  assert.equal(view.thread.isLoading, false);
  assert.match(view.thread.queryErrorMessage, /사용할 수 없는 문서/);
});

test("서버가 받은 뒤 실패하면 입력을 되돌리지 않고 목록을 다시 받아 실패를 보여 준다", async (t) => {
  const server = questionServer(t);
  const view = renderThread();
  await advance(t, 0);
  const before = server.messageRequests;
  server.messages = pair("p1", { run_id: "agent_1", status: "failed" });

  const rejected = await view.thread.submitDocumentQuestion("질문", async ({ onAccepted }) => {
    onAccepted("agent_1");
    throw new Error("답변을 만들지 못했습니다.");
  });
  await advance(t, 0);

  assert.equal(rejected, false);
  assert.ok(server.messageRequests > before);
  assert.deepEqual(view.thread.messages.map((message) => message.id), ["p1-u", "p1-a"]);
});

test("Esc 취소는 agent turn 취소를 요청하고 진행 표시를 내린다", async (t) => {
  const server = questionServer(t);
  const view = renderThread();
  await advance(t, 0);
  let signal;
  void view.thread.submitDocumentQuestion("질문", ({ onAccepted, signal: abort }) => {
    signal = abort;
    onAccepted("agent_1");
    return new Promise((_, reject) => abort.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  await advance(t, 0);

  view.thread.cancelQuery();
  await advance(t, 0);

  assert.equal(server.cancels.length, 1);
  assert.match(server.cancels[0], /agent_1\/cancel$/);
  assert.equal(signal.aborted, true);
  assert.equal(view.thread.isLoading, false);
  assert.equal(view.thread.activeTurn, null);
});
