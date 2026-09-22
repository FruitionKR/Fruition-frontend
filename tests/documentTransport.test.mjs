import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}});
const { GET: transportRoute } = await import("../app/api/document-transport/route.ts");
const { apiFetch } = await import("../src/shared/api/client.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { uploadDocumentFile } = await import("../src/entities/document/api/document.ts");
const { saveNoteDraft, NoteContentConflictError } = await import("../src/features/note-editing/api/note.ts");
function browser(t) {
  const old = globalThis.window;
  const oldFlag = process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API;
  process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API = "true";
  t.after(() => { if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API; else process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API = oldFlag; });
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old; });
  saveAccessToken("access-test");
}
const transport = () => Response.json({ origin: "https://api.example.test", directUpload: true });
function serverEnv(t, values) {
  const keys = ["BACKEND_URL", "DOCUMENT_DIRECT_UPLOAD_ENABLED"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; });
  t.after(() => keys.forEach(key => { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }));
}
test("transport route enables direct upload by default when BACKEND_URL is set", async t => {
  serverEnv(t, { BACKEND_URL: "https://api.example.test/base" });
  const response = transportRoute();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { origin: "https://api.example.test", directUpload: true });
});
test("transport route turns direct upload off only with an explicit false flag", async t => {
  serverEnv(t, { BACKEND_URL: "https://api.example.test", DOCUMENT_DIRECT_UPLOAD_ENABLED: "false" });
  assert.deepEqual(await transportRoute().json(), { origin: "https://api.example.test", directUpload: false });
});
test("transport route keeps direct upload enabled with the legacy true flag", async t => {
  serverEnv(t, { BACKEND_URL: "https://api.example.test", DOCUMENT_DIRECT_UPLOAD_ENABLED: "true" });
  assert.deepEqual(await transportRoute().json(), { origin: "https://api.example.test", directUpload: true });
});
test("transport route stays disabled without BACKEND_URL", async t => {
  serverEnv(t, {});
  assert.deepEqual(await transportRoute().json(), { origin: null, directUpload: false });
});
test("large PDF is sent in parts to storage without auth and completion goes to AWS", async t => {
  browser(t);
  const file = new File([new Uint8Array(6 * 1024 * 1024)], "large.pdf", { type: "application/pdf" });
  let storageSeen = false;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/document-transport") return transport();
    if (path === "https://api.example.test/api/workspaces/ws_test/document-tree" && (!init?.method || init.method === "GET")) return Response.json({ items: [] });
    if (path === "https://api.example.test/api/workspaces/ws_test/documents/uploads") {
      assert.equal(init.headers.get("Authorization"), "Bearer access-test");
      assert.equal(JSON.parse(init.body).size, file.size);
      return Response.json({ ticket: "ticket", part_size: 64 * 1024 * 1024, part_count: 1 });
    }
    if (path.endsWith("/uploads/parts")) return Response.json({ parts: [{ part_number: 1, url: "https://storage.example.test/bucket" }] });
    if (path === "https://storage.example.test/bucket") {
      assert.equal(init.headers, undefined);
      assert.equal(init.credentials, "omit");
      assert.equal(init.body.size, file.size);
      assert.equal(init.method, "PUT");
      storageSeen = true;
      return new Response(null, { status: 204 });
    }
    assert.equal(path, "https://api.example.test/api/workspaces/ws_test/documents/uploads/complete");
    assert.equal(storageSeen, true);
    assert.equal(JSON.parse(init.body).ticket, "ticket");
    assert.ok(init.headers.get("Idempotency-Key"));
    return Response.json({ id: "doc_saved" });
  });
  assert.equal((await uploadDocumentFile(file)).id, "doc_saved");
});
test("editing preserves revision conflict and does not proxy the body through Vercel", async t => {
  browser(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/document-transport") return transport();
    if (path === "https://api.example.test/api/workspaces/ws_test/document-tree" && (!init?.method || init.method === "GET")) return Response.json({ items: [] });
    assert.equal(path, "https://api.example.test/api/workspaces/ws_test/documents/doc_test/content");
    assert.equal(init.method, "PUT");
    assert.equal(init.body.get("base_revision"), "12");
    assert.equal(await init.body.get("markdown").text(), "# changed");
    return Response.json({ error: { message: "revision conflict" } }, { status: 409 });
  });
  await assert.rejects(saveNoteDraft("doc_test", "# changed", 12), NoteContentConflictError);
});
test("expired token refreshes on the same origin and retries the same direct body", async t => {
  browser(t);
  const body = new FormData(); body.set("file", new Blob(["data"]));
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/document-transport") return transport();
    if (path === "https://api.example.test/api/workspaces/ws_test/document-tree" && (!init?.method || init.method === "GET")) return Response.json({ items: [] });
    if (path === "/api/auth/refresh") return Response.json({ access_token: "renewed" });
    assert.equal(path, "https://api.example.test/api/workspaces/ws_test/documents");
    assert.equal(init.body, body);
    if (++attempts === 1) return new Response(null, { status: 401 });
    assert.equal(init.headers.get("Authorization"), "Bearer renewed");
    return new Response(null, { status: 201 });
  });
  assert.equal((await apiFetch("/api/workspaces/ws_test/documents", { method: "POST", body })).status, 201);
});
test("access-code rejection prevents any direct AWS call", async t => {
  browser(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/document-transport");
    return Response.json({ error: { message: "접근 코드 필요" } }, { status: 403 });
  });
  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), /접근 코드 필요/);
});
test("failed storage PUT aborts without registering a document", async t => {
  browser(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/document-transport") return transport();
    if (path === "https://api.example.test/api/workspaces/ws_test/document-tree" && (!init?.method || init.method === "GET")) return Response.json({ items: [] });
    if (path.endsWith("/documents/uploads")) return Response.json({ part_size: 64 * 1024 * 1024, part_count: 1, ticket: "ticket" });
    if (path.endsWith("/uploads/parts")) return Response.json({ parts: [{ part_number: 1, url: "https://storage.example.test/bucket" }] });
    if (path.endsWith("/uploads/abort")) return new Response(null, { status: 204 });
    assert.equal(path, "https://storage.example.test/bucket");
    return new Response(null, { status: 403 });
  });
  await assert.rejects(uploadDocumentFile(new File(["pdf"], "file.pdf")), /파일 조각 전송 실패/);
});


test("3GiB upload slices at long offsets with at most three concurrent PUTs and renews expired URLs", async t => {
  browser(t);
  const size = 3 * 1024 ** 3;
  const chunk = 64 * 1024 ** 2;
  const offsets = [];
  const file = { name: "huge.pdf", size, slice(start, end) { offsets.push([start, end]); return { size: end - start }; } };
  let concurrent = 0, maxConcurrent = 0, retries = 0;
  const uploaded = new Set();
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/document-transport") return transport();
    if (path.endsWith("/document-tree")) return Response.json({ items: [] });
    if (path.endsWith("/uploads")) return Response.json({ ticket: "ticket", part_size: chunk, part_count: 48 });
    if (path.endsWith("/parts")) {
      const { first_part, count } = JSON.parse(init.body);
      if (first_part === 1 && count === 1) retries++;
      return Response.json({ parts: Array.from({ length: count }, (_, index) => ({ part_number: first_part + index, url: `https://storage.example.test/${first_part + index}?renewed=${retries}` })) });
    }
    if (path.startsWith("https://storage.example.test/")) {
      concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 0));
      concurrent--;
      const part = Number(new URL(path).pathname.slice(1));
      if (part === 1 && retries === 0) return new Response(null, { status: 403 });
      uploaded.add(part);
      assert.equal(init.body.size, chunk);
      return new Response(null, { status: 200 });
    }
    assert.ok(path.endsWith("/complete"));
    assert.equal(uploaded.size, 48);
    return Response.json({ id: "huge" });
  });
  assert.equal((await uploadDocumentFile(file)).id, "huge");
  assert.equal(offsets.at(-1)[1], size);
  assert.ok(offsets.some(([start]) => start > 2 * 1024 ** 3));
  assert.equal(maxConcurrent, 3);
  assert.equal(retries, 1);
});
