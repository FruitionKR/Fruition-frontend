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
const { fetchSkillReferenceDocuments, uploadSkillReferenceDocument } = await import("../src/entities/document/api/document.ts");
const { usesDocumentTransport } = await import("../src/shared/api/documentTransport.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");

function selectWorkspace(t) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("참고 문서 목록은 origin=skill_reference로 조회한다", async (t) => {
  selectWorkspace(t);
  const documents = [{ id: "ref_1", filename: "양식.md" }];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/documents?origin=skill_reference");
    assert.equal(init?.cache, "no-store");
    return Response.json({ documents });
  });
  assert.deepEqual(await fetchSkillReferenceDocuments(), documents);
});

test("참고 문서 업로드는 origin을 쿼리로 보내고 폴더를 지정하지 않는다", async (t) => {
  selectWorkspace(t);
  const uploaded = { id: "ref_1", filename: "양식.md" };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/documents?origin=skill_reference");
    assert.equal(init?.method, "POST");
    assert.ok(new Headers(init?.headers).get("Idempotency-Key"));
    assert.equal(init?.body.get("file").name, "양식.md");
    assert.equal(init?.body.has("folder_id"), false);
    return Response.json(uploaded, { status: 201 });
  });
  assert.deepEqual(await uploadSkillReferenceDocument(new File(["# 양식"], "양식.md", { type: "text/markdown" })), uploaded);
});

test("업로드 거절은 status와 code를 담은 ApiError로 던진다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "UNSUPPORTED_FILE_TYPE", message: "PDF" } }, { status: 415 })
  );
  await assert.rejects(
    uploadSkillReferenceDocument(new File(["%PDF-"], "a.pdf")),
    (error) => error instanceof ApiError && error.status === 415 && error.code === "UNSUPPORTED_FILE_TYPE"
  );
});

test("쿼리가 붙은 문서 경로도 문서 API 전송을 쓴다", () => {
  assert.equal(usesDocumentTransport("/api/workspaces/ws_test/documents?origin=skill_reference"), true);
  assert.equal(usesDocumentTransport("/api/workspaces/ws_test/documents"), true);
  assert.equal(usesDocumentTransport("/api/workspaces/ws_test/documents-other"), false);
});
