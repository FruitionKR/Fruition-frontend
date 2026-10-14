import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { createDesktopFolderPort, createDesktopStatePort, listConnections } = await import("../src/features/desktop-sync/bridge/desktopBridge.ts");
const { createSyncScheduler } = await import("../src/features/desktop-sync/model/syncScheduler.ts");

/** preload가 노출하는 window.fruitionDesktop 흉내. 채널별 응답을 정해 둔다. */
function fakeDesktop(responses = {}) {
  const calls = [];
  const listeners = [];
  return {
    calls, listeners,
    async invoke(channel, ...args) { calls.push([channel, ...args]); const r = responses[channel]; return typeof r === "function" ? r(...args) : r; },
    onSyncNow(listener) { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); }
  };
}

test("파일은 IPC 바이트를 File로 되돌리고, Blob은 바이트로 바꿔 보낸다", async () => {
  const desktop = fakeDesktop({
    "folder.readFile": { name: "논문.pdf", bytes: new TextEncoder().encode("%PDF"), hash: "h1" },
    "folder.writeBytes": "h2",
    "folder.saveAside": ".fruition/sync/conflicts/x/논문.pdf"
  });
  const port = createDesktopFolderPort(desktop, "ws_a");
  const { file, hash } = await port.readFile("자료/논문.pdf");
  assert.equal(file.name, "논문.pdf");
  assert.equal(await file.text(), "%PDF");
  assert.equal(hash, "h1");
  assert.equal(await port.writeBlob("자료/논문.pdf", new Blob(["%PDF-2"])), "h2");
  await port.saveAside("자료/논문.pdf", new Blob(["로컬"]));
  const [, ws, path, bytes] = desktop.calls.find(([channel]) => channel === "folder.writeBytes");
  assert.deepEqual([ws, path, new TextDecoder().decode(bytes)], ["ws_a", "자료/논문.pdf", "%PDF-2"]);
  const aside = desktop.calls.find(([channel]) => channel === "folder.saveAside");
  assert.equal(new TextDecoder().decode(aside[3]), "로컬");
});

test("텍스트 읽기·쓰기와 상태 저장은 워크스페이스 id를 붙여 그대로 전달한다", async () => {
  const desktop = fakeDesktop({ "folder.readText": { text: "본문", hash: "h" }, "state.load": { records: [], readonlyIds: [], pendingKeys: {} } });
  const port = createDesktopFolderPort(desktop, "ws_a");
  assert.deepEqual(await port.readText("메모.md"), { text: "본문", hash: "h" });
  await port.writeText("메모.md", "새 본문");
  const state = createDesktopStatePort(desktop, "ws_a");
  await state.save(await state.load());
  assert.deepEqual(desktop.calls.map(([channel, ...args]) => [channel, args[0]]), [
    ["folder.readText", "ws_a"], ["folder.writeText", "ws_a"], ["state.load", "ws_a"], ["state.save", "ws_a"]
  ]);
});

test("연결 목록을 받는다", async () => {
  const desktop = fakeDesktop({ listConnections: [{ workspaceId: "ws_a", folderPath: "/f", mode: "auto" }] });
  assert.deepEqual(await listConnections(desktop), [{ workspaceId: "ws_a", folderPath: "/f", mode: "auto" }]);
});

test("주기 실행은 자동 동기화 워크스페이스만 돌린다", async () => {
  const desktop = fakeDesktop({ listConnections: [{ workspaceId: "ws_auto", mode: "auto" }, { workspaceId: "ws_manual", mode: "manual" }] });
  const ran = [];
  const scheduler = createSyncScheduler({ desktop, runWorkspace: async (id) => { ran.push(id); return []; } });
  await scheduler.tick(false);
  assert.deepEqual(ran, ["ws_auto"]);
});

test("지금 동기화는 수동 워크스페이스까지 모두 돌린다", async () => {
  const desktop = fakeDesktop({ listConnections: [{ workspaceId: "ws_auto", mode: "auto" }, { workspaceId: "ws_manual", mode: "manual" }] });
  const ran = [];
  const scheduler = createSyncScheduler({ desktop, runWorkspace: async (id) => { ran.push(id); return []; } });
  await scheduler.tick(true);
  assert.deepEqual(ran, ["ws_auto", "ws_manual"]);
});

test("이전 실행이 끝나기 전에는 겹쳐 실행하지 않는다", async () => {
  const desktop = fakeDesktop({ listConnections: [{ workspaceId: "ws_a", mode: "auto" }] });
  let release;
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  let runs = 0;
  const scheduler = createSyncScheduler({
    desktop,
    runWorkspace: async () => { runs += 1; started(); await new Promise((resolve) => { release = resolve; }); return []; }
  });
  const first = scheduler.tick(false);
  await running;
  await scheduler.tick(false);
  release();
  await first;
  assert.equal(runs, 1);
});

test("한 워크스페이스가 실패해도 다음 워크스페이스는 돌리고 결과를 알린다", async () => {
  const desktop = fakeDesktop({ listConnections: [{ workspaceId: "ws_a", mode: "auto" }, { workspaceId: "ws_b", mode: "auto" }] });
  const reports = [];
  const scheduler = createSyncScheduler({
    desktop,
    runWorkspace: async (id) => { if (id === "ws_a") throw new Error("폴더를 읽지 못함"); return [{ kind: "collision", paths: ["a.md"] }]; },
    onReport: (report) => reports.push(report)
  });
  await scheduler.tick(false);
  assert.deepEqual(reports, [
    { workspaceId: "ws_a", error: "폴더를 읽지 못함", events: [] },
    { workspaceId: "ws_b", events: [{ kind: "collision", paths: ["a.md"] }] }
  ]);
});

const { runWorkspaceSync } = await import("../src/features/desktop-sync/model/runWorkspaceSync.ts");

test("워크스페이스 동기화는 파일 동기화 뒤 위키 미러를 돌리고, 멈췄으면 위키는 건너뛴다", async (t) => {
  const emptyState = { records: [], readonlyIds: [], pendingKeys: {} };
  const desktop = fakeDesktop({ "folder.list": [], "state.load": () => emptyState, "state.save": null });
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    if (path.endsWith("/document-tree")) return Response.json({ items: [] });
    if (path.endsWith("/wiki/maintenance/status")) return Response.json({ last_wiki_change_at: "c1" });
    if (path.endsWith("/wiki/graph")) return Response.json({ nodes: [], edges: [] });
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(await runWorkspaceSync(desktop, "ws_a"), []);
  assert.deepEqual(paths, ["/api/workspaces/ws_a/document-tree", "/api/workspaces/ws_a/wiki/maintenance/status", "/api/workspaces/ws_a/wiki/graph"]);

  paths.length = 0;
  t.mock.method(globalThis, "fetch", async (path) => { paths.push(path); return new Response(null, { status: 503 }); });
  assert.deepEqual(await runWorkspaceSync(desktop, "ws_a"), [{ kind: "paused", reason: "retry" }]);
  assert.deepEqual(paths, ["/api/workspaces/ws_a/document-tree"]);
});
