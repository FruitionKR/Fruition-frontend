import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});
const { createMarkdownDocument } = await import("../src/entities/document/api/document.ts");
const { ApiError, UPLOAD_LIMIT_MESSAGES } = await import("../src/shared/lib/apiErrors.ts");

function selectWorkspace(t) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("AI 초안 새 문서는 Markdown 생성 API에 agent_run_id와 함께 보낸다", async (t) => {
  selectWorkspace(t);
  const created = { id: "doc_1", filename: "초안.md" };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/documents/markdown");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.ok(headers.get("Idempotency-Key"));
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(init?.body), {
      display_name: "초안", markdown: "<!-- fruition-note: n1 -->\n# 초안\n", folder_id: "folder_1", agent_run_id: "agent_1"
    });
    return Response.json(created, { status: 201 });
  });
  assert.deepEqual(await createMarkdownDocument({
    displayName: "초안", markdown: "<!-- fruition-note: n1 -->\n# 초안\n", folderId: "folder_1", agentRunId: "agent_1"
  }), created);
});

test("폴더·run이 없으면 null로 보낸다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    const body = JSON.parse(init?.body);
    assert.equal(body.folder_id, null);
    assert.equal(body.agent_run_id, null);
    return Response.json({ id: "doc_1", filename: "a.md" }, { status: 201 });
  });
  await createMarkdownDocument({ displayName: "a", markdown: "", folderId: null, agentRunId: null });
});

test("저장 공간 초과는 기존 안내 문구의 ApiError로 던진다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "STORAGE_QUOTA_EXCEEDED", message: "quota" } }, { status: 413 })
  );
  await assert.rejects(
    createMarkdownDocument({ displayName: "a", markdown: "x", folderId: null, agentRunId: "agent_1" }),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "STORAGE_QUOTA_EXCEEDED"
      && error.message === UPLOAD_LIMIT_MESSAGES.STORAGE_QUOTA_EXCEEDED
  );
});
