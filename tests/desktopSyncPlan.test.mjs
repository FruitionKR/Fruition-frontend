import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { planSync } = await import("../src/features/desktop-sync/model/planSync.ts");

const record = (overrides = {}) => ({
  documentId: "doc_1", localPath: "자료/메모.md", remotePath: "자료/메모.md",
  localHash: "h1", remoteUpdatedAt: "t1", ...overrides
});
const remote = (overrides = {}) => ({ documentId: "doc_1", path: "자료/메모.md", updatedAt: "t1", readonly: false, ...overrides });
const local = (overrides = {}) => ({ path: "자료/메모.md", hash: "h1", ...overrides });

test("양쪽 다 바뀌지 않았으면 할 일이 없다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local()], remote: [remote()] }), []);
});

test("로컬에만 있는 새 파일은 업로드한다", () => {
  assert.deepEqual(planSync({ records: [], local: [local({ path: "자료/새 파일.pdf", hash: "h9" })], remote: [] }), [
    { type: "upload", localPath: "자료/새 파일.pdf" }
  ]);
});

test("서버에만 있는 새 문서는 서버 이름 그대로 내려받는다", () => {
  assert.deepEqual(planSync({ records: [], local: [], remote: [remote({ documentId: "doc_2", path: "자료/논문A.md" })] }), [
    { type: "download", documentId: "doc_2", localPath: "자료/논문A.md" }
  ]);
});

test("첫 연결에서 같은 경로에 양쪽 다 있으면 내용을 비교한다", () => {
  assert.deepEqual(planSync({ records: [], local: [local()], remote: [remote()] }), [
    { type: "compare", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("로컬 .txt는 서버 .md와 같은 경로로 보고, NFD·대소문자 차이도 무시한다", () => {
  const nfdPath = "자료/회의.TXT".normalize("NFD");
  assert.deepEqual(planSync({ records: [], local: [local({ path: nfdPath })], remote: [remote({ path: "자료/회의.md" })] }), [
    { type: "compare", documentId: "doc_1", localPath: nfdPath }
  ]);
});

test("로컬만 바뀌면 서버에 반영한다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local({ hash: "h2" })], remote: [remote()] }), [
    { type: "push", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("서버만 바뀌면 로컬에 반영한다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local()], remote: [remote({ updatedAt: "t2" })] }), [
    { type: "pull", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("양쪽 다 바뀌면 충돌이다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local({ hash: "h2" })], remote: [remote({ updatedAt: "t2" })] }), [
    { type: "conflict", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("읽기 전용 문서를 로컬에서 고치면 올리지 않고 알린다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local({ hash: "h2" })], remote: [remote({ readonly: true })] }), [
    { type: "readonly", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("로컬에서 지우면 서버 휴지통으로 보낸다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [], remote: [remote()] }), [
    { type: "delete-remote", documentId: "doc_1" }
  ]);
});

test("서버에서 지워지면 로컬 파일을 휴지통으로 옮긴다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local()], remote: [] }), [
    { type: "trash-local", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});


test("로컬에서 지웠는데 서버가 바뀌었으면 다시 내려받는다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [], remote: [remote({ updatedAt: "t2" })] }), [
    { type: "download", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("읽기 전용 문서를 로컬에서 지우면 서버는 그대로 두고 다시 내려받는다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [], remote: [remote({ readonly: true })] }), [
    { type: "download", documentId: "doc_1", localPath: "자료/메모.md" }
  ]);
});

test("양쪽에서 모두 지워졌으면 기록만 지운다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [], remote: [] }), [
    { type: "forget", documentId: "doc_1" }
  ]);
});

test("같은 내용이 다른 로컬 경로에 나타나면 서버 문서를 옮긴다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local({ path: "자료/회의록/메모.md" })], remote: [remote()] }), [
    { type: "move-remote", documentId: "doc_1", localPath: "자료/회의록/메모.md" }
  ]);
});

test("서버에서 이름이 바뀌면 로컬 파일도 옮기고 .txt 확장자는 유지한다", () => {
  const records = [record({ localPath: "자료/회의.txt", remotePath: "자료/회의.md" })];
  assert.deepEqual(planSync({ records, local: [local({ path: "자료/회의.txt" })], remote: [remote({ path: "자료/정리/결정.md" })] }), [
    { type: "move-local", documentId: "doc_1", fromPath: "자료/회의.txt", toPath: "자료/정리/결정.txt" }
  ]);
});

test("서버에서 옮기면서 내용도 바뀌면 옮긴 뒤 내려받는다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local()], remote: [remote({ path: "자료/새/메모.md", updatedAt: "t2" })] }), [
    { type: "move-local", documentId: "doc_1", fromPath: "자료/메모.md", toPath: "자료/새/메모.md" },
    { type: "pull", documentId: "doc_1", localPath: "자료/새/메모.md" }
  ]);
});

test("같은 폴더의 a.txt와 a.md처럼 서버에서 같은 이름이 되는 로컬 파일은 이름 충돌로 알린다", () => {
  assert.deepEqual(planSync({ records: [], local: [local({ path: "자료/a.txt" }), local({ path: "자료/a.md", hash: "h2" })], remote: [] }), [
    { type: "collision", paths: ["자료/a.txt", "자료/a.md"] }
  ]);
});

test("이름 충돌 중 기록된 파일은 그대로 동기화하고 나머지만 알린다", () => {
  const records = [record({ localPath: "자료/a.md", remotePath: "자료/a.md" })];
  assert.deepEqual(planSync({ records, local: [local({ path: "자료/a.md" }), local({ path: "자료/A.md", hash: "h2" })], remote: [remote({ path: "자료/a.md" })] }), [
    { type: "collision", paths: ["자료/A.md"] }
  ]);
});

test("기록 없는 서버 문서 둘이 같은 경로면 내려받지 않고 이름 충돌로 알린다", () => {
  const remotes = [remote({ documentId: "doc_a", path: "자료/x.md" }), remote({ documentId: "doc_b", path: "자료/X.md" })];
  assert.deepEqual(planSync({ records: [], local: [], remote: remotes }), [
    { type: "collision", paths: ["자료/x.md", "자료/X.md"] }
  ]);
});

test("이동 후보가 새 서버 문서와 같은 경로면 이동으로 보지 않는다", () => {
  const remotes = [remote(), remote({ documentId: "doc_new", path: "자료/새.md" })];
  const actions = planSync({ records: [record()], local: [local({ path: "자료/새.md" })], remote: remotes });
  assert.deepEqual(actions, [
    { type: "delete-remote", documentId: "doc_1" },
    { type: "compare", documentId: "doc_new", localPath: "자료/새.md" }
  ]);
});

test("같은 내용의 새 파일이 여럿이면 이동으로 보지 않는다", () => {
  const actions = planSync({ records: [record()], local: [local({ path: "자료/b.md" }), local({ path: "자료/c.md" })], remote: [remote()] });
  assert.deepEqual(actions, [
    { type: "delete-remote", documentId: "doc_1" },
    { type: "upload", localPath: "자료/b.md" },
    { type: "upload", localPath: "자료/c.md" }
  ]);
});

test("내려받을 자리에 다른 로컬 파일이 있으면 덮어쓰지 않고 이름 충돌로 알린다", () => {
  const records = [
    record({ localPath: "자료/a.md", remotePath: "자료/a.md" }),
    record({ documentId: "doc_2", localPath: "자료/b.md", remotePath: "자료/b.md", localHash: "h2" })
  ];
  const remotes = [remote({ path: "자료/b.md" }), remote({ documentId: "doc_2", path: "자료/a.md" })];
  const locals = [local({ path: "자료/a.md" }), local({ path: "자료/b.md", hash: "h2" })];
  const actions = planSync({ records, local: locals, remote: remotes });
  assert.deepEqual(actions, [
    { type: "collision", paths: ["자료/b.md"] },
    { type: "collision", paths: ["자료/a.md"] }
  ]);
});

test("로컬에서 지운 사이 서버에서 이름이 바뀌었으면 서버 문서를 지우지 않고 새 이름으로 내려받는다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [], remote: [remote({ path: "자료/바뀐 이름.md" })] }), [
    { type: "download", documentId: "doc_1", localPath: "자료/바뀐 이름.md" }
  ]);
});

test("서버에서 지워진 문서를 다시 올릴 때 옛 문서 id를 함께 넘긴다", () => {
  assert.deepEqual(planSync({ records: [record()], local: [local({ hash: "h2" })], remote: [] }), [
    { type: "upload", localPath: "자료/메모.md", replacesDocumentId: "doc_1" }
  ]);
});

test("읽기 전용 문서를 로컬에서 이름만 바꾸면 사본을 올리지 않고 원래 자리에 다시 내려받는다", () => {
  const actions = planSync({ records: [record()], local: [local({ path: "자료/새 이름.md" })], remote: [remote({ readonly: true })] });
  assert.deepEqual(actions, [
    { type: "download", documentId: "doc_1", localPath: "자료/메모.md" },
    { type: "readonly", documentId: "doc_1", localPath: "자료/새 이름.md" }
  ]);
});

test("실행 순서는 정리 → 이동 → 내려받기 → 올리기다", () => {
  const records = [
    record({ documentId: "doc_del", localPath: "x/del.md", remotePath: "x/del.md" }),
    record({ documentId: "doc_mv", localPath: "x/mv.md", remotePath: "x/mv.md", localHash: "hm" }),
    record({ documentId: "doc_push", localPath: "x/push.md", remotePath: "x/push.md", localHash: "hp" })
  ];
  const locals = [local({ path: "x/new.pdf", hash: "hn" }), local({ path: "x/push.md", hash: "hp2" }), local({ path: "x/mv.md", hash: "hm" }), local({ path: "x/del.md" })];
  const remotes = [
    remote({ documentId: "doc_mv", path: "x/moved.md" }),
    remote({ documentId: "doc_push", path: "x/push.md" }),
    remote({ documentId: "doc_dl", path: "x/dl.md" })
  ];
  assert.deepEqual(planSync({ records, local: locals, remote: remotes }).map((action) => action.type), [
    "trash-local", "move-local", "download", "push", "upload"
  ]);
});
