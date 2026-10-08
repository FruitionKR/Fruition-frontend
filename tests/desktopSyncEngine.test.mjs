import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { runSyncCycle } = await import("../src/features/desktop-sync/model/syncEngine.ts");
const { ApiError, SessionExpiredError } = await import("../src/shared/lib/errors.ts");

const MARKER = "<!-- fruition-note: doc_1 -->";
const hashOf = (text) => `#${text}`;

/** 메모리 위의 연결 폴더. 내용 해시는 "#"+내용으로 단순화한다. */
function fakeFolder(files = {}) {
  const store = new Map(Object.entries(files));
  const trashed = [];
  const aside = [];
  return {
    store, trashed, aside,
    async list() { return [...store].map(([path, text]) => ({ path, hash: hashOf(text) })); },
    async readText(path) { return { text: store.get(path), hash: hashOf(store.get(path)) }; },
    async readFile(path) { return { file: new File([store.get(path)], path.split("/").pop()), hash: hashOf(store.get(path)) }; },
    async hashOf(path) { return store.has(path) ? hashOf(store.get(path)) : null; },
    async writeText(path, text) { store.set(path, text); return hashOf(text); },
    async writeBlob(path, blob) { const text = await blob.text(); store.set(path, text); return hashOf(text); },
    async move(from, to) { store.set(to, store.get(from)); store.delete(from); },
    async trash(path) { trashed.push(path); store.delete(path); },
    async saveAside(path, content) { aside.push({ path, content }); return `.fruition/sync/conflicts/${path}`; }
  };
}

function fakeState(initial = {}) {
  let state = { records: [], readonlyIds: [], pendingKeys: {}, ...initial };
  return { get current() { return state; }, async load() { return state; }, async save(next) { state = next; } };
}

const docItem = (id, name, extra = {}) => ({
  type: "document", id, name, sort_order: 0, current_version: extra.current_version ?? 2,
  document: { id, filename: name, document_role: name.endsWith(".pdf") ? "ORIGINAL" : "EDITABLE", editable: !name.endsWith(".pdf"), updated_at: extra.updated_at ?? "t1" }
});

/** 호출을 기록하는 가짜 API. overrides로 메서드를 바꾼다. */
function fakeApi(tree, overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === "function" ? result(...args) : result; };
  return {
    calls,
    fetchTree: record("fetchTree", () => tree),
    fetchSyncDocument: record("fetchSyncDocument", (ws, id) => ({
      id, filename: "메모.md", documentRole: "EDITABLE", editable: true, status: "completed",
      currentVersion: 2, editRevision: 5, updatedAt: "t1", markdown: `${MARKER}\n서버 본문\n`, folderId: null, sourceDocumentId: null
    })),
    fetchSyncOriginal: record("fetchSyncOriginal", new Blob(["%PDF"])),
    saveSyncContent: record("saveSyncContent", { revision: 6, updatedAt: "t2" }),
    uploadSyncFile: record("uploadSyncFile", (ws, file) => ({ id: "doc_new", filename: file.name })),
    createSyncFolder: record("createSyncFolder", (ws, name) => ({ id: `f_${name}`, current_version: 1 })),
    moveSyncDocument: record("moveSyncDocument", undefined),
    renameSyncDocument: record("renameSyncDocument", undefined),
    deleteSyncDocument: record("deleteSyncDocument", undefined),
    ...overrides
  };
}

function deps(folder, state, api, workspaceId = "ws_a") {
  let n = 0;
  return { workspaceId, local: folder, state, api, newKey: () => `key_${++n}`, now: () => Date.parse("2026-10-09T00:00:00Z") };
}

const record = (overrides = {}) => ({
  documentId: "doc_1", localPath: "메모.md", remotePath: "메모.md", localHash: hashOf("본문\n"),
  remoteUpdatedAt: "t1", marker: MARKER, editRevision: 5, ...overrides
});

test("새 로컬 파일은 상위 폴더를 만들어 올리고 기록을 남긴다", async () => {
  const folder = fakeFolder({ "자료/회의/메모.md": "본문\n" });
  const state = fakeState();
  const api = fakeApi([]);
  await runSyncCycle(deps(folder, state, api));
  const created = api.calls.filter(([name]) => name === "createSyncFolder").map((call) => [call[2], call[3]]);
  assert.deepEqual(created, [["자료", null], ["회의", "f_자료"]]);
  const upload = api.calls.find(([name]) => name === "uploadSyncFile");
  assert.equal(upload[3], "f_회의");
  assert.deepEqual(state.current.records, [{
    documentId: "doc_new", localPath: "자료/회의/메모.md", remotePath: "자료/회의/메모.md",
    localHash: hashOf("본문\n"), remoteUpdatedAt: "t1", marker: MARKER, editRevision: 5
  }]);
});

test("새 서버 문서는 첫 줄 마커를 떼고 내려받는다", async () => {
  const folder = fakeFolder();
  const state = fakeState();
  await runSyncCycle(deps(folder, state, fakeApi([docItem("doc_1", "메모.md")])));
  assert.equal(folder.store.get("메모.md"), "서버 본문\n");
  assert.equal(state.current.records[0].marker, MARKER);
  assert.equal(state.current.records[0].localHash, hashOf("서버 본문\n"));
});

test("PDF 문서는 원본 파일을 내려받는다", async () => {
  const folder = fakeFolder();
  await runSyncCycle(deps(folder, fakeState(), fakeApi([docItem("doc_pdf", "논문.pdf")])));
  assert.equal(folder.store.get("논문.pdf"), "%PDF");
});

test("로컬 변경은 보관한 마커와 버전으로 저장하고 기록을 갱신한다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")]);
  await runSyncCycle(deps(folder, state, api));
  const save = api.calls.find(([name]) => name === "saveSyncContent");
  assert.deepEqual(save.slice(1), ["ws_a", "doc_1", { markdown: `${MARKER}\n고친 본문\n`, baseRevision: 5, revisionWriteId: "key_1" }]);
  assert.deepEqual(
    { hash: state.current.records[0].localHash, revision: state.current.records[0].editRevision, updatedAt: state.current.records[0].remoteUpdatedAt },
    { hash: hashOf("고친 본문\n"), revision: 6, updatedAt: "t2" }
  );
  assert.deepEqual(state.current.pendingKeys, {});
});

test("저장이 버전 충돌이면 로컬 내용을 사본으로 보존하고 서버 본으로 되돌린다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    saveSyncContent: async () => { throw new ApiError("충돌", 409, "DOCUMENT_VERSION_CONFLICT"); }
  });
  const result = await runSyncCycle(deps(folder, state, api));
  assert.deepEqual(folder.aside, [{ path: "메모.md", content: "고친 본문\n" }]);
  assert.equal(folder.store.get("메모.md"), "서버 본문\n");
  assert.deepEqual(result.events, [{ kind: "conflict", path: "메모.md", asidePath: ".fruition/sync/conflicts/메모.md" }]);
});

test("서버 내용이 로컬과 같으면 다시 쓰지 않고 기록만 갱신한다", async () => {
  const folder = fakeFolder({ "메모.md": "서버 본문\n" });
  const state = fakeState({ records: [record({ localHash: hashOf("서버 본문\n") })] });
  let writes = 0;
  folder.writeText = async () => { writes += 1; return ""; };
  await runSyncCycle(deps(folder, state, fakeApi([docItem("doc_1", "메모.md", { updated_at: "t9" })])));
  assert.equal(writes, 0);
  assert.equal(state.current.records[0].remoteUpdatedAt, "t9");
});

test("로컬에서 지운 문서는 트리의 버전으로 서버 휴지통에 보낸다", async () => {
  const folder = fakeFolder({ "남은.md": "x" });
  const state = fakeState({ records: [record(), record({ documentId: "doc_2", localPath: "남은.md", remotePath: "남은.md", localHash: hashOf("x") })] });
  const api = fakeApi([docItem("doc_1", "메모.md", { current_version: 7 }), docItem("doc_2", "남은.md")]);
  await runSyncCycle(deps(folder, state, api));
  const deletion = api.calls.find(([name]) => name === "deleteSyncDocument");
  assert.deepEqual(deletion.slice(1), ["ws_a", "doc_1", 7, "key_1"]);
  assert.deepEqual(state.current.records.map((item) => item.documentId), ["doc_2"]);
});

test("서버에서 지워진 문서는 로컬 파일을 휴지통으로 옮긴다", async () => {
  const folder = fakeFolder({ "메모.md": "본문\n" });
  const state = fakeState({ records: [record()] });
  await runSyncCycle(deps(folder, state, fakeApi([])));
  assert.deepEqual(folder.trashed, ["메모.md"]);
  assert.deepEqual(state.current.records, []);
});

test("로컬 폴더가 비어 보이면 서버 문서를 지우지 않고 멈춘다", async () => {
  const folder = fakeFolder();
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")]);
  const result = await runSyncCycle(deps(folder, state, api));
  assert.equal(api.calls.some(([name]) => name === "deleteSyncDocument"), false);
  assert.deepEqual(result.events, [{ kind: "paused", reason: "mass-delete" }]);
});

test("저장 권한이 없으면 읽기 전용으로 기록하고 알린다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    saveSyncContent: async () => { throw new ApiError("권한", 403, "DOCUMENT_WRITE_FORBIDDEN"); }
  });
  const result = await runSyncCycle(deps(folder, state, api));
  assert.deepEqual(state.current.readonlyIds, ["doc_1"]);
  assert.deepEqual(result.events, [{ kind: "readonly", path: "메모.md" }]);
});

test("네트워크 오류면 주기를 멈추고, 다음 주기에 같은 키로 다시 보낸다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record()] });
  let attempts = 0;
  const writeIds = [];
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    saveSyncContent: async (ws, id, content) => {
      writeIds.push(content.revisionWriteId);
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return { revision: 6, updatedAt: "t2" };
    }
  });
  const shared = deps(folder, state, api);
  const first = await runSyncCycle(shared);
  assert.deepEqual(first.events, [{ kind: "paused", reason: "retry" }]);
  await runSyncCycle(shared);
  assert.deepEqual(writeIds, ["key_1", "key_1"]);
});

test("세션이 만료되면 주기를 멈춘다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    saveSyncContent: async () => { throw new SessionExpiredError("만료"); }
  });
  const result = await runSyncCycle(deps(folder, fakeState({ records: [record()] }), api));
  assert.deepEqual(result.events, [{ kind: "paused", reason: "session-expired" }]);
});

test("로컬에서 옮기고 이름을 바꾼 파일은 서버에서도 옮기고 이름을 바꾼다", async () => {
  const folder = fakeFolder({ "정리/결정.md": "본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")]);
  await runSyncCycle(deps(folder, state, api));
  const move = api.calls.find(([name]) => name === "moveSyncDocument");
  const rename = api.calls.find(([name]) => name === "renameSyncDocument");
  assert.deepEqual(move.slice(1, 5), ["ws_a", "doc_1", "f_정리", 2]);
  assert.deepEqual(rename.slice(1), ["ws_a", "doc_1", "결정", 2]);
  assert.equal(state.current.records[0].localPath, "정리/결정.md");
  assert.equal(state.current.records[0].remotePath, "정리/결정.md");
});

test("서버에서 이름이 바뀐 뒤 로컬 변경을 올리면 옮긴 경로의 해시를 기록한다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record()] });
  await runSyncCycle(deps(folder, state, fakeApi([docItem("doc_1", "새 이름.md")])));
  assert.equal(folder.store.get("새 이름.md"), "고친 본문\n");
  assert.equal(state.current.records[0].localHash, hashOf("고친 본문\n"));
});

test("주기 도중 사용자가 고친 파일은 서버 본으로 덮기 전에 사본으로 보존한다", async () => {
  const folder = fakeFolder({ "메모.md": "본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md", { updated_at: "t2" })], {
    fetchSyncDocument: async (ws, id) => {
      folder.store.set("메모.md", "방금 고친 본문\n");
      return { id, filename: "메모.md", documentRole: "EDITABLE", editable: true, status: "completed", currentVersion: 2, editRevision: 6, updatedAt: "t2", markdown: `${MARKER}\n서버 본문\n`, folderId: null, sourceDocumentId: null };
    }
  });
  const result = await runSyncCycle(deps(folder, state, api));
  assert.deepEqual(folder.aside, [{ path: "메모.md", content: "방금 고친 본문\n" }]);
  assert.equal(folder.store.get("메모.md"), "서버 본문\n");
  assert.deepEqual(result.events, [{ kind: "conflict", path: "메모.md", asidePath: ".fruition/sync/conflicts/메모.md" }]);
});

test("본문이 아직 없는 문서는 빈 파일로 내려받지 않고 기다린다", async () => {
  const folder = fakeFolder();
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    fetchSyncDocument: async (ws, id) => ({ id, filename: "메모.md", documentRole: "EDITABLE", editable: true, status: "processing", currentVersion: 1, editRevision: 0, updatedAt: "t1", markdown: null, folderId: null, sourceDocumentId: null })
  });
  const state = fakeState();
  const result = await runSyncCycle(deps(folder, state, api));
  assert.equal(folder.store.has("메모.md"), false);
  assert.deepEqual(state.current.records, []);
  assert.deepEqual(result.events, [{ kind: "waiting", path: "메모.md" }]);
});

test("버전이 비어 있는 마크다운 기록은 서버 문서를 지우지 않고 버전을 다시 읽어 저장한다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const state = fakeState({ records: [record({ editRevision: null, marker: null })] });
  const api = fakeApi([docItem("doc_1", "메모.md")]);
  await runSyncCycle(deps(folder, state, api));
  assert.equal(api.calls.some(([name]) => name === "deleteSyncDocument"), false);
  const save = api.calls.find(([name]) => name === "saveSyncContent");
  assert.deepEqual(save[3], { markdown: `${MARKER}\n고친 본문\n`, baseRevision: 5, revisionWriteId: "key_1" });
});

test("서버 이동 뒤 이름 변경이 실패해도 이동한 위치를 기록한다", async () => {
  const folder = fakeFolder({ "정리/결정.md": "본문\n" });
  const state = fakeState({ records: [record()] });
  const api = fakeApi([docItem("doc_1", "메모.md")], {
    renameSyncDocument: async () => { throw new ApiError("이름", 400); }
  });
  await runSyncCycle(deps(folder, state, api));
  assert.equal(state.current.records[0].remotePath, "정리/메모.md");
});

test("24시간이 지난 재전송 키는 버리고 새 키를 쓴다", async () => {
  const folder = fakeFolder({ "메모.md": "고친 본문\n" });
  const old = { key: "key_old", createdAt: Date.parse("2026-10-07T00:00:00Z") };
  const state = fakeState({ records: [record()], pendingKeys: { [`push:doc_1:${hashOf("고친 본문\n")}`]: old } });
  const api = fakeApi([docItem("doc_1", "메모.md")]);
  await runSyncCycle(deps(folder, state, api));
  assert.equal(api.calls.find(([name]) => name === "saveSyncContent")[3].revisionWriteId, "key_1");
});
