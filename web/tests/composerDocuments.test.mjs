import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const {
  canAddComposerDocument,
  composerDocumentChipLabel,
  composerDocumentOptions,
  followUpReferenceDocumentIds,
  moveActiveOption,
  parseDocumentMention,
  pruneUnavailableAttachments,
  readOnlyReferenceDocumentId,
  referenceDocuments,
  turnReferenceDocumentIds,
  removeDocumentMention,
  autoIncludedOpenDocumentId,
  droppedOpenDocumentMessage: droppedOpenDocumentMessageWith,
  documentLockedTurnMessage: documentLockedTurnMessageWith,
  sendTurnDroppingOpenDocument,
  shouldRestoreAttachments
} = await import("../src/widgets/agent-panel/lib/composerDocuments.ts");
const droppedOpenDocumentMessage = (...args) => droppedOpenDocumentMessageWith(...args, agentChatT);
const documentLockedTurnMessage = (...args) => documentLockedTurnMessageWith(...args, agentChatT);
const { ApiError, DocumentLockedError } = await import("../src/shared/lib/apiErrors.ts");

const doc = (id, filename, extra = {}) => ({
  id,
  filename,
  mime_type: "text/markdown",
  document_role: "EDITABLE",
  status: "uploaded",
  uploaded_at: `2026-01-${id.padStart(2, "0")}T00:00:00Z`,
  ...extra
});

test("@는 입력 처음이나 공백 뒤에서만 열고 커서 앞 글자로 거른다", () => {
  assert.deepEqual(parseDocumentMention("@", 1), { query: "", start: 0, end: 1 });
  assert.deepEqual(parseDocumentMention("@회의", 3), { query: "회의", start: 0, end: 3 });
  assert.deepEqual(parseDocumentMention("요약해 줘 @회의", 9), { query: "회의", start: 6, end: 9 });
  assert.deepEqual(parseDocumentMention("첫 줄\n@회", 6), { query: "회", start: 4, end: 6 });
});

test("이메일처럼 글자 뒤의 @, 커서가 지나간 @, 공백이 낀 검색어는 열지 않는다", () => {
  assert.equal(parseDocumentMention("demo@fruition.local", 19), null);
  assert.equal(parseDocumentMention("메일a@", 4), null);
  assert.equal(parseDocumentMention("@회의 록", 5), null);
  assert.equal(parseDocumentMention("@@", 2), null);
  assert.equal(parseDocumentMention("글자 @회의", 2), null);
  assert.equal(parseDocumentMention("@회의", null), null);
});

test("커서가 검색어 가운데면 커서 앞으로 거르되 지울 때는 끝까지 지운다", () => {
  assert.deepEqual(parseDocumentMention("@회의록 정리", 2), { query: "회", start: 0, end: 4 });
});

test("고른 뒤 @검색어를 지우고 커서를 그 자리에 둔다", () => {
  assert.deepEqual(removeDocumentMention("@회의", { query: "회의", start: 0, end: 3 }), { value: "", caret: 0 });
  assert.deepEqual(removeDocumentMention("요약 @회의", { query: "회의", start: 3, end: 6 }), { value: "요약 ", caret: 3 });
  // 공백이 두 칸으로 남지 않는다.
  assert.deepEqual(removeDocumentMention("요약 @회의 해 줘", { query: "회의", start: 3, end: 6 }), { value: "요약 해 줘", caret: 3 });
  assert.deepEqual(removeDocumentMention("@회의 해 줘", { query: "회의", start: 0, end: 3 }), { value: "해 줘", caret: 0 });
});

test("목록: Markdown만 넣고 PDF·txt·변환 중·이미 고른 문서는 뺀다. 변환 실패는 목록으로 가려낼 수 없어 넣는다", () => {
  const documents = [
    doc("1", "회의록.md"),
    doc("2", "논문.pdf", { mime_type: "application/pdf", document_role: "ORIGINAL" }),
    doc("3", "메모.txt", { mime_type: "text/plain", document_role: "ORIGINAL" }),
    doc("4", "변환 중.md", { status: "processing", pipeline_run_id: "convert:1" }),
    doc("5", "변환 실패.md", { status: "failed", pipeline_run_id: "convert:2" }),
    doc("6", "편입 실패.md", { status: "failed", pipeline_run_id: "ingest:1" }),
    doc("7", "변환 완료.md", { source_document_id: "2", pipeline_run_id: "convert:3" }),
    doc("8", "보기 권한.md", { can_edit: false }),
    doc("9", "고른 문서.md")
  ];
  const options = composerDocumentOptions({ documents, query: "", attachments: [documents[8]], openDocumentId: null, isOpenDocumentAttached: false });
  assert.deepEqual(options.map((item) => item.id), ["8", "7", "6", "5", "1"]);
});

test("목록: 현재 문서는 칩이 붙어 있으면 빼고, ×로 뺐으면 맨 앞에 넣는다", () => {
  const documents = [doc("1", "현재.md"), doc("2", "다른.md")];
  const base = { documents, query: "", attachments: [], openDocumentId: "1" };
  assert.deepEqual(composerDocumentOptions({ ...base, isOpenDocumentAttached: true }).map((item) => item.id), ["2"]);
  assert.deepEqual(composerDocumentOptions({ ...base, isOpenDocumentAttached: false }).map((item) => item.id), ["1", "2"]);
});

test("목록: 한글 검색은 조합형(NFD) 파일명도 찾고 대소문자를 가리지 않는다", () => {
  const documents = [doc("1", "회의록.md".normalize("NFD")), doc("2", "Weekly Report.md"), doc("3", "할 일.md")];
  const search = (query) => composerDocumentOptions({ documents, query, attachments: [], openDocumentId: null, isOpenDocumentAttached: false }).map((item) => item.id);
  assert.deepEqual(search("회의"), ["1"]);
  assert.deepEqual(search("weekly"), ["2"]);
  assert.deepEqual(search("없는 문서"), []);
});

test("3개를 다 고르면 더 넣을 수 없되, ×로 뺀 현재 문서는 3개와 별개라 다시 붙일 수 있다", () => {
  const attachments = [doc("1", "a.md"), doc("2", "b.md"), doc("3", "c.md")];
  const documents = [...attachments, doc("4", "현재.md"), doc("5", "다른.md")];
  assert.equal(canAddComposerDocument(2, false), true);
  assert.equal(canAddComposerDocument(3, false), false);
  assert.equal(canAddComposerDocument(3, true), true);
  const options = composerDocumentOptions({ documents, query: "", attachments, openDocumentId: "4", isOpenDocumentAttached: false });
  assert.deepEqual(options.map((item) => item.id), ["4"]);
  assert.deepEqual(composerDocumentOptions({ documents, query: "", attachments, openDocumentId: "4", isOpenDocumentAttached: true }), []);
});

test("방향키는 처음이 정해지지 않았으면 첫·끝으로 가고 양끝을 잇는다", () => {
  const ids = ["a", "b", "c"];
  assert.equal(moveActiveOption(ids, "a", 1), "b");
  assert.equal(moveActiveOption(ids, "c", 1), "a");
  assert.equal(moveActiveOption(ids, "a", -1), "c");
  assert.equal(moveActiveOption([], null, 1), null);
});

test("칩은 확장자를 떼고 NFC로 보여 준다", () => {
  assert.equal(composerDocumentChipLabel(doc("1", "회의록.md".normalize("NFD"))), "회의록");
  assert.equal(composerDocumentChipLabel(doc("1", "notes.markdown")), "notes");
});

test("함께 실린 열린 문서는 첨부에 겹쳐 싣지 않는다", () => {
  const attachments = [doc("1", "a.md"), doc("2", "b.md")];
  assert.deepEqual(referenceDocuments(attachments, "1").map((item) => item.id), ["2"]);
  assert.deepEqual(referenceDocuments(attachments, null).map((item) => item.id), ["1", "2"]);
});

test("다시 보내기·되묻기 답은 같은 요청의 첨부를 이어받고 다른 요청·대화는 받지 않는다", () => {
  const last = { session_id: "s1", message: "/smart 정리", reference_document_ids: ["1"] };
  assert.deepEqual(followUpReferenceDocumentIds(last, "s1", "/smart 정리"), ["1"]);
  assert.deepEqual(followUpReferenceDocumentIds(last, "s1", "/smart 새 문서로 만들어 줘"), ["1"]);
  assert.deepEqual(followUpReferenceDocumentIds(last, "s1", "/other 해 줘"), []);
  assert.deepEqual(followUpReferenceDocumentIds(last, "s2", "/smart 정리"), []);
  assert.deepEqual(followUpReferenceDocumentIds({ ...last, message: "요약해 줘" }, "s1", "번역해 줘"), []);
  assert.deepEqual(followUpReferenceDocumentIds({ session_id: "s1", message: "요약" }, "s1", "요약"), []);
  assert.deepEqual(followUpReferenceDocumentIds(null, "s1", "요약"), []);
});

test("첨부를 실은 요청을 서버가 받기 전에 400으로 거절하면 입력과 첨부를 되돌린다", () => {
  const rejected = new ApiError("고른 문서 중 사용할 수 없는 문서가 있습니다. 다시 골라 주세요.", 400);
  assert.equal(shouldRestoreAttachments(rejected, { referenceDocumentIds: ["1"], turnId: null }), true);
  // 첨부가 없거나, 서버가 이미 받은 turn의 실패거나, 400이 아니면 되돌리지 않는다.
  assert.equal(shouldRestoreAttachments(rejected, { referenceDocumentIds: [], turnId: null }), false);
  assert.equal(shouldRestoreAttachments(rejected, { referenceDocumentIds: ["1"], turnId: "t1" }), false);
  assert.equal(shouldRestoreAttachments(new ApiError("오류", 500), { referenceDocumentIds: ["1"], turnId: null }), false);
  assert.equal(shouldRestoreAttachments(new Error("x"), { referenceDocumentIds: ["1"], turnId: null }), false);
  // 크레딧 부족은 입력을 되돌리는 기존 동작과 같이 첨부도 되돌린다.
  const credit = new ApiError("크레딧 부족", 402, "INSUFFICIENT_CREDIT");
  assert.equal(shouldRestoreAttachments(credit, { referenceDocumentIds: ["1"], turnId: null }), true);
});

test("열린 문서 잠금(423)으로 시작되지 못한 요청은 입력과 첨부를 유지한다", () => {
  const locked = new ApiError("김지현님이 편집 중입니다.", 423, "DOCUMENT_EDIT_LOCKED");
  assert.equal(shouldRestoreAttachments(locked, { referenceDocumentIds: ["1"], turnId: null }), true);
  // 첨부가 없어도 입력은 되돌린다. 빈 목록이라 칩은 그대로다.
  assert.equal(shouldRestoreAttachments(locked, { referenceDocumentIds: [], turnId: null }), true);
  assert.equal(shouldRestoreAttachments(locked, { referenceDocumentIds: ["1"], turnId: "t1" }), false);
});

test("열린 문서 잠금 안내는 어느 문서가 잠겼는지와 첨부로 계속하는 방법을 말한다", () => {
  const locked = new ApiError("김지현님이 편집 중입니다.", 423, "DOCUMENT_EDIT_LOCKED");
  assert.equal(
    documentLockedTurnMessage(locked, { openDocumentTitle: "아키텍처", hasAttachments: true }),
    "현재 문서 '아키텍처'에서 다른 사람이 편집 중이에요. 현재 문서 칩을 빼면 첨부 문서로 계속할 수 있어요."
  );
  assert.equal(
    documentLockedTurnMessage(locked, { openDocumentTitle: "아키텍처", hasAttachments: false }),
    "현재 문서 '아키텍처'에서 다른 사람이 편집 중이에요. 편집이 끝난 뒤 다시 시도해 주세요."
  );
  assert.equal(
    documentLockedTurnMessage(locked, { openDocumentTitle: null, hasAttachments: true }),
    "현재 문서에서 다른 사람이 편집 중이에요. 현재 문서 칩을 빼면 첨부 문서로 계속할 수 있어요."
  );
  // 서버가 잠긴 문서 제목을 주면 그 값을 먼저 쓴다.
  const titled = new DocumentLockedError("편집 중", 423, "DOCUMENT_EDIT_LOCKED", "회의록");
  assert.match(documentLockedTurnMessage(titled, { openDocumentTitle: "아키텍처", hasAttachments: true }), /현재 문서 '회의록'/);
  // 다른 오류는 건드리지 않는다.
  assert.equal(documentLockedTurnMessage(new ApiError("오류", 500), { openDocumentTitle: "아키텍처", hasAttachments: true }), null);
  assert.equal(documentLockedTurnMessage(new Error("x"), { openDocumentTitle: "아키텍처", hasAttachments: true }), null);
});

test("423 응답의 잠긴 문서 제목을 보존하고, 없으면 비워 둔다", async () => {
  const { parseApiError } = await import("../src/shared/api/client.ts");
  const response = (error) => new Response(JSON.stringify({ error }), { status: 423 });
  const titled = await parseApiError(response({ code: "DOCUMENT_EDIT_LOCKED", message: "편집 중", locked_document_name: "회의록" }), "실패");
  assert.ok(titled instanceof DocumentLockedError);
  assert.equal(titled.documentTitle, "회의록");
  assert.equal((await parseApiError(response({ code: "DOCUMENT_EDIT_LOCKED", message: "편집 중" }), "실패")).documentTitle, null);
});

test("되돌린 첨부에서 지금 고를 수 없는 문서(삭제·변환 중)를 뺀다", () => {
  const live = doc("1", "남은 문서.md");
  const converting = doc("2", "변환 중.md", { status: "processing", pipeline_run_id: "convert:1" });
  const removed = doc("3", "삭제된 문서.md");
  assert.deepEqual(pruneUnavailableAttachments([live, converting, removed], [live, converting]).map((item) => item.id), ["1"]);
});

test("보기 권한으로 연 문서는 첨부 자리를 차지해 함께 3개까지만 실린다", () => {
  const attachments = [doc("1", "a.md"), doc("2", "b.md")];
  const documents = [...attachments, doc("4", "현재.md"), doc("5", "다른.md")];
  const reference = { documents, query: "", attachments, openDocumentId: "4", isOpenDocumentReference: true };
  assert.deepEqual(composerDocumentOptions({ ...reference, isOpenDocumentAttached: true }), [], "보기 문서까지 3개면 더 고를 수 없다");
  assert.deepEqual(composerDocumentOptions({ ...reference, isOpenDocumentAttached: false }).map((item) => item.id), ["4", "5"], "칩을 뺐으면 자리가 남는다");
  const full = [...attachments, doc("3", "c.md")];
  assert.deepEqual(composerDocumentOptions({ ...reference, documents: [...documents, full[2]], attachments: full, isOpenDocumentAttached: false }), [], "첨부가 찼으면 보기 문서도 넣을 수 없다");
  assert.equal(canAddComposerDocument(2, false, { isOpenDocumentReference: true, isOpenDocumentAttached: true }), false);
  assert.equal(canAddComposerDocument(2, true, { isOpenDocumentReference: true, isOpenDocumentAttached: false }), true);
  assert.equal(canAddComposerDocument(3, true, { isOpenDocumentReference: true, isOpenDocumentAttached: false }), false);
});

test("보기 권한으로 연 문서는 Markdown 본문이 있을 때만 근거로 싣는다", () => {
  const markdown = { ...doc("1", "보기.md"), can_edit: false };
  assert.equal(readOnlyReferenceDocumentId(markdown), "1");
  assert.equal(readOnlyReferenceDocumentId({ ...markdown, can_edit: true }), null, "편집할 수 있는 문서는 편집 문맥으로 싣는다");
  assert.equal(readOnlyReferenceDocumentId({ ...markdown, filename: "보기.pdf", document_role: "ORIGINAL" }), null, "PDF 원본은 서버가 첨부를 400으로 거절한다");
  assert.equal(readOnlyReferenceDocumentId({ ...markdown, status: "processing", pipeline_run_id: "convert:run" }), null, "변환 중이면 본문이 없다");
  assert.equal(readOnlyReferenceDocumentId(null), null);
});

test("보낼 근거에 보기 권한 문서를 겹치지 않게 넣는다", () => {
  const attachments = [doc("1", "a.md")];
  assert.deepEqual(turnReferenceDocumentIds(attachments, "9"), ["9", "1"]);
  assert.deepEqual(turnReferenceDocumentIds(attachments, "1"), ["1"]);
  assert.deepEqual(turnReferenceDocumentIds(attachments, null), ["1"]);
});

test("자동으로 실린 열린 문서만 뺄 수 있는 문서로 본다", () => {
  const options = { attachments: [doc("1", "a.md")], optedInDocumentId: null };
  assert.equal(autoIncludedOpenDocumentId("9", options), "9");
  assert.equal(autoIncludedOpenDocumentId(null, options), null, "실리지 않았으면 없다");
  assert.equal(autoIncludedOpenDocumentId("1", options), null, "직접 첨부한 문서를 연 경우");
  assert.equal(autoIncludedOpenDocumentId("9", { ...options, optedInDocumentId: "9" }), null, "칩을 눌러 직접 고른 경우");
});

const badRequest = () => new ApiError("고른 문서 중 사용할 수 없는 문서가 있습니다. 다시 골라 주세요.", 400, "INVALID_REQUEST");

function fakeSend(results) {
  const calls = [];
  return { calls, send: async (ids) => {
    calls.push(ids);
    const result = results[calls.length - 1];
    if (result instanceof Error) throw result;
    return result;
  } };
}

test("자동으로 실은 문서 때문에 시작되지 못한 요청은 그 문서를 빼고 한 번만 다시 보낸다", async () => {
  const { calls, send } = fakeSend([badRequest(), "ok"]);
  const result = await sendTurnDroppingOpenDocument({ referenceDocumentIds: ["9", "1"], autoDocumentId: "9", hasStarted: () => false, send });
  assert.equal(result, "ok");
  assert.deepEqual(calls, [["9", "1"], ["1"]]);
});

test("빼고 보내도 400이면 더 보내지 않고 그 오류를 그대로 준다", async () => {
  const second = badRequest();
  const { calls, send } = fakeSend([badRequest(), second, "never"]);
  await assert.rejects(sendTurnDroppingOpenDocument({ referenceDocumentIds: ["9", "1"], autoDocumentId: "9", hasStarted: () => false, send }), (error) => error === second);
  assert.equal(calls.length, 2);
});

test("직접 첨부한 문서만 실은 요청의 400은 다시 보내지 않는다", async () => {
  const first = badRequest();
  const { calls, send } = fakeSend([first, "never"]);
  await assert.rejects(sendTurnDroppingOpenDocument({ referenceDocumentIds: ["1"], autoDocumentId: null, hasStarted: () => false, send }), (error) => error === first);
  assert.equal(calls.length, 1);
});

test("서버가 받은 turn의 실패와 400이 아닌 거절은 다시 보내지 않아 두 번 처리되지 않는다", async () => {
  for (const [error, hasStarted] of [
    [badRequest(), true],
    [new ApiError("크레딧 부족", 402, "INSUFFICIENT_CREDIT"), false],
    [new ApiError("잠김", 423), false],
    [new ApiError("서버 오류", 500), false],
    [new TypeError("Failed to fetch"), false]
  ]) {
    const { calls, send } = fakeSend([error, "never"]);
    await assert.rejects(sendTurnDroppingOpenDocument({ referenceDocumentIds: ["9"], autoDocumentId: "9", hasStarted: () => hasStarted, send }), (thrown) => thrown === error);
    assert.equal(calls.length, 1, `${error.message}`);
  }
});

test("문서를 빼고 보냈다는 안내에 어느 문서인지 밝힌다", () => {
  assert.match(droppedOpenDocumentMessage("회의록"), /'회의록'/);
  assert.match(droppedOpenDocumentMessage(null), /현재 문서/);
});
