import assert from "node:assert/strict";
import test from "node:test";
import { ID, PDF, PNG, notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const { analyzeNotionZip } = await import("../src/features/notion-import/model/analyzeNotionZip.ts");
const { runImport, createRunState, summarizeRun, countImportSteps, deterministicUuid, importKey } = await import("../src/features/notion-import/model/importRunner.ts");
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
    },
    async uploadPdf(file, folderId, key) {
      calls.push({ kind: "pdf", name: file.name, folderId, key, type: file.type, size: file.size });
      const error = fail("pdf", file.name);
      if (error) throw error;
      const id = `pdf_${++sequence}`;
      documents.set(id, { name: file.name, version: 1 });
      return { id };
    },
    async convertPdf(documentId, key) {
      calls.push({ kind: "convert", documentId, key });
      const error = fail("convert", documents.get(documentId).name);
      if (error) throw error;
    }
  };
}

test("폴더 → 문서 → 링크·이미지 본문 순서로 보내고, 하위 페이지가 있는 페이지는 폴더 옆에 만든다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const writer = fakeWriter();
  const state = createRunState();
  const progress = [];
  const result = await runImport(plan, { importId: "imp_1", writer, state, onProgress: (value) => progress.push(value) });
  assert.deepEqual(result, { fatalMessage: null, cancelled: false });

  assert.deepEqual([writer.calls[0].kind, writer.calls[0].name], ["folder", "홈"]);
  const homeCreate = writer.calls.find((call) => call.kind === "document" && call.name === "홈");
  assert.equal(homeCreate.folderId, null, "페이지 문서는 폴더 안이 아니라 폴더와 같은 위치에 둔다");
  assert.equal(homeCreate.markdown, "", "링크가 있는 문서는 빈 본문으로 먼저 만든다");
  assert.equal(writer.calls.find((call) => call.kind === "document" && call.name === "하위").folderId, "folder_홈");
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
  // 미리보기(문서·표·PDF를 나눠 셈)와 같은 기준으로 완료 화면에 보인다. 행 페이지는 문서에 들어간다.
  assert.deepEqual([counts.created, counts.createdPages, counts.createdTables, counts.createdPdfs, counts.convertingPdfs], [7, 5, 1, 1, 1]);
  assert.equal(counts.createdPages, plan.documents.length - plan.tableCount);
  assert.equal(counts.failed, 0);
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
  // 이미 보낸 동시 요청(최대 2개)만 끝나고 더 보내지 않는다.
  assert.ok(writer.calls.filter((call) => call.kind === "document").length <= 2);
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

test("PDF는 행 문서 옆 폴더에 결정적 키로 올리고 변환을 요청하며, 표·본문 링크를 행 문서·PDF 문서로 채운다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const writer = fakeWriter();
  const state = createRunState();
  await runImport(plan, { importId: "imp_6", writer, state });
  const rowDir = `홈 ${ID.home}/할일 ${ID.db}/행 ${ID.row}`;
  const upload = writer.calls.find((call) => call.kind === "pdf");
  assert.deepEqual(upload, { kind: "pdf", name: "첨부.pdf", folderId: `folder_행`, key: await importKey("imp_6", `${rowDir}/첨부.pdf`, "pdf"), type: "application/pdf", size: PDF.length });
  const pdfId = state.documents.get(`${rowDir}/첨부.pdf`).id;
  assert.deepEqual(writer.calls.filter((call) => call.kind === "convert"), [{ kind: "convert", documentId: pdfId, key: await importKey("imp_6", `${rowDir}/첨부.pdf`, "convert") }]);
  // PDF 업로드는 본문 저장(링크 채우기)보다 먼저 끝난다.
  assert.ok(writer.calls.findIndex((call) => call.kind === "pdf") < writer.calls.findIndex((call) => call.kind === "content"));

  const rowId = state.documents.get(`${rowDir}.md`).id;
  const row = writer.documents.get(rowId).markdown;
  assert.match(row, new RegExp(`\\[첨부\\]\\(/home\\?doc=${pdfId}\\)`));
  assert.match(row, new RegExp(`\\| 담당 \\| \\[홈\\]\\(/home\\?doc=${state.documents.get(`홈 ${ID.home}.md`).id}\\) \\|`));
  const table = writer.documents.get(state.documents.get(`홈 ${ID.home}/할일 ${ID.db}_all.csv`).id).markdown;
  assert.match(table, new RegExp(`\\| \\[행\\]\\(/home\\?doc=${rowId}\\) \\| 진행 \\|`));
});

test("PDF 변환 요청만 실패하면 다시 시도할 때 올리지 않고 변환만 다시 보낸다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  let failOnce = true;
  const writer = fakeWriter({
    fail: (kind) => {
      if (kind !== "convert" || !failOnce) return null;
      failOnce = false;
      return new ApiError("크레딧이 부족해 작업을 시작하지 않았습니다.", 402, "INSUFFICIENT_CREDIT");
    }
  });
  const state = createRunState();
  await runImport(plan, { importId: "imp_7", writer, state });
  assert.deepEqual([...state.failures.values()].map((failure) => failure.label), ["첨부.pdf"]);
  assert.equal(summarizeRun(plan, state).createdPdfs, 1);
  assert.equal(summarizeRun(plan, state).convertingPdfs, 0);
  writer.calls.length = 0;
  await runImport(plan, { importId: "imp_7", writer, state });
  assert.deepEqual(writer.calls.map((call) => call.kind), ["convert"]);
  assert.equal(state.failures.size, 0);
});

test("PDF 업로드가 저장 용량을 넘으면 멈추고, 너무 큰 PDF는 그 항목만 실패로 남긴다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const quota = await runImport(plan, {
    importId: "imp_8",
    writer: fakeWriter({ fail: (kind) => kind === "pdf" ? new ApiError("저장 공간 부족", 413, "STORAGE_QUOTA_EXCEEDED") : null }),
    state: createRunState()
  });
  assert.equal(quota.fatalMessage, "저장 공간 부족");

  const state = createRunState();
  const tooLarge = await runImport(plan, {
    importId: "imp_9",
    writer: fakeWriter({ fail: (kind) => kind === "pdf" ? new ApiError("PDF 파일은 100MB 이하로 올려 주세요.", 413, "FILE_TOO_LARGE") : null }),
    state
  });
  assert.equal(tooLarge.fatalMessage, null);
  assert.deepEqual([...state.failures.values()].map((failure) => [failure.label, failure.message]), [["첨부.pdf", "파일이 너무 커서 올리지 못했어요. PDF는 100MB 이하만 가져올 수 있어요."]]);
  // PDF가 없어 본문의 PDF 링크는 글자만 남는다.
  assert.equal(summarizeRun(plan, state).failed, 1);
});
