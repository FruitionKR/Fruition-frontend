import assert from "node:assert/strict";
import test from "node:test";
import { ID, PNG, notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const { analyzeNotionZip } = await import("../src/features/notion-import/model/analyzeNotionZip.ts");
const { runImport, createRunState, summarizeRun, countImportSteps, deterministicUuid } = await import("../src/features/notion-import/model/importRunner.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const ATTACHMENT = /attachment:\/\/([0-9a-f-]{36})/g;

/** 서버 흉내 writer. 호출을 기록하고 fail(kind, name)이 참이면 그 요청을 실패시킨다. */
function fakeWriter({ fail = () => null } = {}) {
  const calls = [];
  let sequence = 0;
  const documents = new Map();
  return {
    calls,
    documents,
    async createFolder(name, parentFolderId, key) {
      calls.push({ kind: "folder", name, parentFolderId, key });
      const error = fail("folder", name);
      if (error) throw error;
      return { id: `folder_${name}` };
    },
    async createDocument(name, markdown, folderId, key) {
      calls.push({ kind: "document", name, markdown, folderId, key });
      const error = fail("document", name);
      if (error) throw error;
      const id = `doc_${++sequence}`;
      documents.set(id, { name, markdown, version: 1 });
      return { id, current_version: 1 };
    },
    async saveContent(documentId, markdown, baseVersion, attachments, writeId) {
      calls.push({ kind: "content", documentId, markdown, baseVersion, attachments, writeId });
      const document = documents.get(documentId);
      const error = fail("content", document.name);
      if (error) throw error;
      const placeholders = [...markdown.matchAll(ATTACHMENT)].map((match) => match[1]);
      assert.deepEqual([...new Set(placeholders)].sort(), attachments.map((attachment) => attachment.id).sort(), "placeholder와 첨부가 같아야 한다");
      assert.ok(attachments.length <= 20);
      assert.equal(baseVersion, document.version);
      document.version += 1;
      document.markdown = markdown.replace(ATTACHMENT, (_whole, id) => `/api/workspaces/ws_1/assets/${id}/content`);
      return {
        current_version: document.version,
        attachments: attachments.map(({ id }) => ({ attachment_id: id, content_path: `/api/workspaces/ws_1/assets/${id}/content` }))
      };
    }
  };
}

test("폴더 → 폴더 첫 문서 → 나머지 문서 → 링크·이미지 본문 순서로 보낸다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const writer = fakeWriter();
  const state = createRunState();
  const progress = [];
  const result = await runImport(plan, { importId: "imp_1", writer, state, onProgress: (value) => progress.push(value) });
  assert.deepEqual(result, { fatalMessage: null, cancelled: false });

  assert.deepEqual(writer.calls.slice(0, 2).map((call) => [call.kind, call.name]), [["folder", "홈"], ["document", "홈"]]);
  assert.equal(writer.calls[1].folderId, "folder_홈");
  assert.equal(writer.calls[1].markdown, "", "링크가 있는 문서는 빈 본문으로 먼저 만든다");
  const memo = writer.calls.find((call) => call.kind === "document" && call.name === "메모");
  assert.equal(memo.markdown, "# 메모 둘\n", "링크·이미지가 없는 문서는 만들 때 본문을 넣고 다시 저장하지 않는다");

  const homeId = state.documents.get(`홈 ${ID.home}.md`).id;
  const childId = state.documents.get(`홈 ${ID.home}/하위 ${ID.child}.md`).id;
  const tableId = state.documents.get(`홈 ${ID.home}/할일 ${ID.db}_all.csv`).id;
  const home = writer.documents.get(homeId).markdown;
  assert.match(home, new RegExp(`\\[하위\\]\\(/home\\?doc=${childId}\\) 와 \\[표\\]\\(/home\\?doc=${tableId}\\)`));
  assert.match(home, /!\[사진\]\(\/api\/workspaces\/ws_1\/assets\/[0-9a-f-]{36}\/content\)/);
  assert.match(writer.documents.get(childId).markdown, new RegExp(`\\[위로\\]\\(/home\\?doc=${homeId}\\)`));

  const imageCall = writer.calls.find((call) => call.kind === "content" && call.attachments.length > 0);
  assert.equal(imageCall.attachments[0].file.type, "image/png");
  assert.equal(imageCall.attachments[0].id, await deterministicUuid(`imp_1\u0000홈 ${ID.home}.md\u0000홈 ${ID.home}/photo.png`));

  assert.equal(state.failures.size, 0);
  assert.deepEqual(progress.at(-1), { done: countImportSteps(plan), total: countImportSteps(plan), phase: "content" });
  const counts = summarizeRun(plan, state);
  // 미리보기(문서·표를 나눠 셈)와 같은 기준으로 완료 화면에 보인다.
  assert.deepEqual([counts.created, counts.createdPages, counts.createdTables], [5, 4, 1]);
  assert.equal(counts.createdPages, plan.documents.length - plan.tableCount);
});

test("이미지가 20개를 넘으면 저장을 나누고 앞 저장의 서버 경로를 이어 쓴다", async () => {
  const files = { "p.md": Array.from({ length: 25 }, (_, index) => `![i${index}](p/${index}.png)`).join("\n") };
  for (let index = 0; index < 25; index += 1) files[`p/${index}.png`] = new Uint8Array([...PNG, index]);
  const plan = await analyzeNotionZip(zipFiles(files));
  const writer = fakeWriter();
  await runImport(plan, { importId: "imp_2", writer, state: createRunState() });
  const saves = writer.calls.filter((call) => call.kind === "content");
  assert.deepEqual(saves.map((call) => call.attachments.length), [20, 5]);
  assert.deepEqual(saves.map((call) => call.baseVersion), [1, 2]);
  // 첫 저장에는 뒤 5개 이미지가 아직 없고, 둘째 저장은 앞 20개를 서버 경로로 담는다.
  assert.equal((saves[0].markdown.match(/!\[/g) ?? []).length, 20);
  assert.equal((saves[1].markdown.match(/\/assets\//g) ?? []).length, 20);
  assert.equal((saves[1].markdown.match(/attachment:\/\//g) ?? []).length, 5);
  const final = [...writer.documents.values()][0].markdown;
  assert.equal((final.match(/\/assets\//g) ?? []).length, 25);
});

test("실패한 항목만 같은 멱등 키로 다시 보낸다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  let failOnce = true;
  const writer = fakeWriter({
    fail: (kind, name) => {
      if (kind === "document" && name === "하위" && failOnce) {
        failOnce = false;
        return new ApiError("일시적 오류", 503);
      }
      return null;
    }
  });
  const state = createRunState();
  await runImport(plan, { importId: "imp_3", writer, state });
  assert.deepEqual([...state.failures.values()].map((failure) => [failure.label, failure.message]), [["하위", "일시적 오류"]]);
  // 홈 본문은 하위 링크를 글자로만 담았다.
  const homeId = state.documents.get(`홈 ${ID.home}.md`).id;
  assert.match(writer.documents.get(homeId).markdown, /^하위 와 \[표\]/m);

  const firstKey = writer.calls.find((call) => call.kind === "document" && call.name === "하위").key;
  writer.calls.length = 0;
  await runImport(plan, { importId: "imp_3", writer, state });
  assert.deepEqual(writer.calls.map((call) => [call.kind, call.name ?? writer.documents.get(call.documentId)?.name]), [["document", "하위"], ["content", "하위"]]);
  assert.equal(writer.calls[0].key, firstKey);
  assert.equal(state.failures.size, 0);
});

test("저장 용량 초과면 남은 요청을 멈추고 그 이유를 돌려준다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const writer = fakeWriter({ fail: (kind) => kind === "document" ? new ApiError("저장 공간 부족", 413, "STORAGE_QUOTA_EXCEEDED") : null });
  const state = createRunState();
  const result = await runImport(plan, { importId: "imp_4", writer, state });
  assert.equal(result.fatalMessage, "저장 공간 부족");
  assert.equal(writer.calls.filter((call) => call.kind === "document").length, 1);
  assert.equal(writer.calls.filter((call) => call.kind === "content").length, 0);
});

test("멈추면 더 보내지 않는다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const controller = new AbortController();
  const writer = fakeWriter();
  const create = writer.createFolder;
  writer.createFolder = async (...args) => {
    const result = await create(...args);
    controller.abort();
    return result;
  };
  const result = await runImport(plan, { importId: "imp_5", writer, state: createRunState(), signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.deepEqual(writer.calls.map((call) => call.kind), ["folder"]);
});
