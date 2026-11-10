import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createResolver } from "./asyncHookShim.mjs";

// useDocumentUpload·useDocumentProcessingNotifications를 실제로 실행한다. 업로드·트리 API와 React Query 등은 가짜로 바꾼다.
const fakes = new URL("./fakeUploadHookDeps.mjs", import.meta.url).href;
registerHooks({ resolve: createResolver({
  "@/entities/document/api/document": fakes,
  "@/entities/tree/api/documentTree": fakes,
  "@/entities/workspace": fakes,
  "@tanstack/react-query": fakes,
  "@/shared/lib/analytics/client": fakes,
  "@/features/wiki-ingest/model/useWikiActionPermissions": fakes,
  "@/features/note-editing/api/note": fakes,
  "@/entities/user": fakes,
  "@/shared/hooks/usePageVisible": fakes,
  // 배럴(index.ts)은 UI(.tsx)까지 내보내 노드에서 읽을 수 없어 알림 버스만 쓴다.
  "@/features/document-notifications": new URL("../src/features/document-notifications/model/noticeBus.ts", import.meta.url).href
}) });

let workspaceId = "ws_test";
globalThis.window = { localStorage: { getItem: () => workspaceId, setItem() {}, removeItem() {} }, setTimeout, clearTimeout };

const { render } = await import("./asyncHookShim.mjs");
const { controls, resetUploadQueue } = await import("./fakeUploadHookDeps.mjs");
const { subscribeNotices, publishNotice } = await import("../src/features/document-notifications/model/noticeBus.ts");
const { useDocumentUpload } = await import("../src/features/document-upload/model/useDocumentUpload.ts");
const { useDocumentProcessingNotifications } = await import("../src/features/document-notifications/model/useDocumentProcessingNotifications.ts");
const { findTreeItem } = await import("../src/entities/tree/lib/treeQueries.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const PROJECT = "project-uploaded-documents";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const doc = (name, extra = {}) => ({ id: `doc-${name}`, filename: name, status: "completed", byte_size: 1, mime_type: "text/markdown", uploaded_at: new Date().toISOString(), ...extra });

/** 훅과 트리 상태를 함께 띄운다. 트리를 바꾸면 훅을 다시 렌더해 다시 올리기가 최신 트리를 보게 한다. */
function setup(t) {
  workspaceId = "ws_test";
  resetUploadQueue();
  const notices = [];
  t.after(subscribeNotices((notice) => notices.push(notice)));
  const state = { projects: [{ id: PROJECT, folderId: null, title: "문서", items: [] }] };
  let box;
  const setProjects = (update) => {
    state.projects = typeof update === "function" ? update(state.projects) : update;
    box?.rerender();
  };
  box = render(() => useDocumentUpload({
    projects: state.projects,
    setProjects,
    setDocuments: () => {},
    setFileDropTarget: () => {},
    refreshBackendData: async () => {}
  }));
  const row = (label) => {
    const items = state.projects[0].items;
    return items.find((item) => item.label === label) ?? findTreeItem(items, label);
  };
  return { notices, state, row, setProjects, upload: () => box.result };
}

const file = (name, body = "x") => new File([body], name, { type: "text/markdown" });

test("대기열을 기다리는 행은 대기 중, 자리를 얻으면 업로드 중이 되고 묶음은 파일별 실패 카드 없이 진행·요약 카드 한 장만 쓴다", async (t) => {
  const { notices, row, upload } = setup(t);
  const replies = new Map();
  controls.upload = (sent) => {
    const reply = deferred();
    replies.set(sent.name, reply);
    return reply.promise;
  };
  const done = upload().dropUploadFiles(PROJECT, null, [file("a.md"), file("b.md"), file("c.md")]);

  assert.equal(row("a.md").uploadWaiting, false, "빈 자리를 얻은 파일은 바로 업로드 중");
  assert.equal(row("b.md").uploadWaiting, false);
  assert.equal(row("c.md").uploadWaiting, true, "세 번째는 대기 중");
  assert.equal(row("c.md").status, "uploading");
  assert.deepEqual(notices.map((notice) => [notice.message, notice.keepOpen]), [["3개 중 0개 완료", true]]);

  await flush();
  replies.get("b.md").reject(new ApiError("용량 초과", 413, "FILE_TOO_LARGE"));
  await flush();
  assert.equal(row("b.md").status, "failed");
  assert.equal(row("b.md").errorMessage, "용량 초과", "사유는 행 tooltip에 남긴다");
  assert.equal(row("c.md").uploadWaiting, false, "자리가 나면 대기 중이던 파일이 업로드 중으로 바뀐다");
  replies.get("a.md").resolve(doc("a.md"));
  replies.get("c.md").resolve(doc("c.md"));
  await done;

  assert.ok(notices.every((notice) => notice.replaceKey === notices[0].replaceKey), "묶음에서는 파일별 실패 카드를 띄우지 않는다");
  const summary = notices.at(-1);
  assert.equal(summary.message, "3개 중 2개를 올렸고 1개는 올리지 못했어요. 실패한 파일만 다시 올릴 수 있어요.");
  assert.equal(summary.keepOpen, undefined, "요약은 자동으로 닫힐 수 있다");

  controls.upload = async (sent) => doc(sent.name);
  controls.sent = [];
  summary.action.onAction();
  summary.action.onAction();
  await flush();
  await flush();
  assert.deepEqual(controls.sent, ["b.md"], "실패한 파일만 한 번 다시 보낸다");
  assert.equal(controls.treeFetches, 0, "서버가 거절한 실패는 트리를 확인하지 않는다");
  assert.equal(row("b.md").status, "completed");
});

test("결과를 알 수 없이 실패한 파일은 서버에 만들어진 문서로 특정될 때만 채택하고 다시 보내지 않는다", async (t) => {
  const { notices, row, upload } = setup(t);
  controls.upload = async () => { throw new TypeError("Failed to fetch"); };
  await upload().dropUploadFiles(PROJECT, null, [file("b.md")]);
  const failed = notices.at(-1);
  assert.equal(failed.title, "업로드 실패");
  assert.ok(failed.action, "파일 하나 실패 카드에 다시 올리기가 있다(사용자가 고를 때까지 남는다)");

  const created = doc("b.md", { id: "server-b" });
  controls.tree = async () => ({ items: [{ type: "document", id: "server-b", name: "b.md", document: created }] });
  controls.sent = [];
  failed.action.onAction();
  await flush();
  await flush();
  assert.equal(controls.treeFetches, 1);
  assert.deepEqual(controls.sent, [], "이미 만들어진 문서는 다시 보내지 않는다");
  assert.deepEqual(controls.ingestRequests, [], "채택한 문서에 편입을 다시 요청하지 않는다");
  assert.equal(row("b.md").documentId, "server-b");
  assert.equal(row("b.md").uploadWaiting, undefined);
});

test("같은 이름 두 파일이 결과를 알 수 없이 실패하면 어느 것의 결과인지 몰라 채택하지 않고 둘 다 다시 보낸다", async (t) => {
  const { notices, upload } = setup(t);
  controls.upload = async () => { throw new TypeError("Failed to fetch"); };
  await upload().dropUploadFiles(PROJECT, null, [file("a.md"), file("a.md")]);
  controls.tree = async () => ({ items: [{ type: "document", id: "server-a", name: "a.md", document: doc("a.md", { id: "server-a" }) }] });
  controls.upload = async (sent) => doc(sent.name, { id: `new-${controls.sent.length}` });
  controls.sent = [];
  notices.at(-1).action.onAction();
  await flush();
  await flush();
  assert.equal(controls.treeFetches, 1, "다시 올리기 묶음당 트리는 한 번만 받는다");
  assert.deepEqual(controls.sent, ["a.md", "a.md"]);
});

test("같은 묶음에서 성공한 a (2).md는 실패한 a.md의 결과로 채택하지 않는다", async (t) => {
  const { notices, upload } = setup(t);
  controls.upload = async (sent) => {
    if (sent.name === "a.md") throw new TypeError("Failed to fetch");
    return doc(sent.name, { id: "server-a2" });
  };
  await upload().dropUploadFiles(PROJECT, null, [file("a.md"), file("a (2).md")]);
  controls.tree = async () => ({ items: [{ type: "document", id: "server-a2", name: "a (2).md", document: doc("a (2).md", { id: "server-a2" }) }] });
  controls.upload = async (sent) => doc(sent.name, { id: "server-a" });
  controls.sent = [];
  notices.at(-1).action.onAction();
  await flush();
  await flush();
  assert.deepEqual(controls.sent, ["a.md"]);
});

test("Markdown 묶음 문서(.md+그림)는 결과를 알 수 없이 실패해도 채택하지 않고 다시 보낸다", async (t) => {
  const { notices, upload } = setup(t);
  controls.upload = async () => { throw new TypeError("Failed to fetch"); };
  const image = new File([new Uint8Array([1, 2, 3])], "img.png", { type: "image/png" });
  await upload().dropUploadFiles(PROJECT, null, [file("note.md", "![](img.png)"), image]);
  const failed = notices.find((notice) => notice.title === "업로드 실패");
  assert.ok(failed?.action);
  controls.tree = async () => ({ items: [{ type: "document", id: "server-note", name: "note.md", document: doc("note.md", { id: "server-note", byte_size: 12 }) }] });
  controls.upload = async (sent) => doc(sent.name);
  controls.sent = [];
  failed.action.onAction();
  await flush();
  await flush();
  assert.equal(controls.treeFetches, 0);
  assert.deepEqual(controls.sent, ["note.md"]);
});

test("대기 중에 워크스페이스를 바꾸면 기다리던 파일을 새 워크스페이스로 보내지 않는다", async (t) => {
  const { row, upload } = setup(t);
  const first = deferred();
  const second = deferred();
  controls.upload = (sent) => (sent.name === "a.md" ? first.promise : sent.name === "b.md" ? second.promise : Promise.resolve(doc(sent.name)));
  const done = upload().dropUploadFiles(PROJECT, null, [file("a.md"), file("b.md"), file("c.md")]);
  await flush();
  workspaceId = "ws_other";
  first.resolve(doc("a.md"));
  second.resolve(doc("b.md"));
  await done;
  assert.deepEqual(controls.sent, ["a.md", "b.md"]);
  assert.equal(row("c.md").status, "failed");
  assert.equal(row("c.md").errorMessage, "워크스페이스가 바뀌어 다시 올리지 않았어요.");
});

test("다시 올리기 전에 실패 행을 지웠으면 업로드하지 않는다", async (t) => {
  const { notices, setProjects, upload } = setup(t);
  controls.upload = async () => { throw new ApiError("거절", 400); };
  await upload().dropUploadFiles(PROJECT, null, [file("gone.md")]);
  setProjects((projects) => projects.map((project) => ({ ...project, items: [] })));
  controls.sent = [];
  notices.at(-1).action.onAction();
  await flush();
  assert.deepEqual(controls.sent, []);
});

test("작업 제안을 받지 않는 코너 스택도 업로드 실패·요약 카드(다시 올리기)는 보이고 작업 제안 카드만 거른다", async (t) => {
  const box = render(() => useDocumentProcessingNotifications([], false, false));
  t.after(() => box.unmount());
  const onAction = () => {};
  publishNotice({ kind: "failed", notificationKey: "uploadFailed", title: "업로드 실패", message: "a", action: { label: "다시 올리기", onAction } });
  publishNotice({ kind: "info", notificationKey: "suggest", title: "위키 편입 제안", message: "b", requiredPermission: "wiki.ingest", action: { label: "편입", onAction } });
  publishNotice({ kind: "failed", notificationKey: "uploadFailed", replaceKey: "batch", title: "일부 업로드 실패", message: "c", action: { label: "다시 올리기", onAction } });
  box.rerender();
  assert.deepEqual(box.result.notices.map((notice) => notice.message), ["a", "c"]);
});
