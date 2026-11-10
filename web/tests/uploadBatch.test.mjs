import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { createConcurrencyLimiter } = await import("../src/shared/lib/concurrencyLimit.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const { ADOPTION_CLOCK_SKEW_MS, documentIdsInTree, isAmbiguousUploadFailure, planUploadAdoptions, runUploadBatch } = await import("../src/features/document-upload/model/uploadBatch.ts");

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("여러 파일 업로드는 끝날 때마다 N개 중 M개 완료를 세고, 끝나면 성공·실패 수와 실패 항목만 돌려준다", async () => {
  const limit = createConcurrencyLimiter(2);
  const replies = { a: deferred(), b: deferred(), c: deferred() };
  const progress = [];
  const running = runUploadBatch(["a", "b", "c"], (name) => limit(() => replies[name].promise), (snapshot) => progress.push(snapshot));

  replies.b.resolve({ ok: false, error: new Error("b failed") });
  await flush();
  replies.a.resolve({ ok: true, value: "doc-a" });
  await flush();
  replies.c.resolve({ ok: true, value: "doc-c" });
  const batch = await running;

  assert.deepEqual(progress, [
    { total: 3, completed: 1, succeeded: 0, failed: 1 },
    { total: 3, completed: 2, succeeded: 1, failed: 1 },
    { total: 3, completed: 3, succeeded: 2, failed: 1 }
  ]);
  assert.deepEqual(batch.results, ["doc-a", null, "doc-c"], "결과는 고른 순서대로, 실패는 null");
  assert.deepEqual(batch.progress, { total: 3, completed: 3, succeeded: 2, failed: 1 });
  assert.deepEqual(batch.failures.map(({ entry, error }) => [entry, error.message]), [["b", "b failed"]]);
});

test("다시 올리기는 실패한 항목만 다시 보내고 성공한 항목은 다시 보내지 않는다", async () => {
  const sent = [];
  const attempt = (failing) => (entry) => {
    sent.push(entry.name);
    return Promise.resolve(failing.has(entry.name) ? { ok: false, error: new TypeError("network") } : { ok: true, value: `doc-${entry.name}` });
  };
  const entries = [{ name: "a.md", itemId: "upload-a" }, { name: "b.md", itemId: "upload-b" }, { name: "c.pdf", itemId: "upload-c" }];
  const first = await runUploadBatch(entries, attempt(new Set(["b.md"])));
  assert.deepEqual(sent, ["a.md", "b.md", "c.pdf"]);

  sent.length = 0;
  const retry = await runUploadBatch(first.failures.map(({ entry }) => entry), attempt(new Set()));
  assert.deepEqual(sent, ["b.md"]);
  assert.deepEqual(retry.failures, []);
  assert.deepEqual(retry.results, ["doc-b.md"]);
  assert.equal(first.failures[0].entry.itemId, "upload-b", "같은 트리 행으로 다시 올린다");
});

test("서버 응답을 받지 못했거나 5xx로 끝난 실패만 결과를 알 수 없는 실패로 본다", () => {
  assert.equal(isAmbiguousUploadFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isAmbiguousUploadFailure(new ApiError("bad gateway", 502)), true);
  assert.equal(isAmbiguousUploadFailure(new ApiError("quota", 413, "STORAGE_QUOTA_EXCEEDED")), false);
  assert.equal(isAmbiguousUploadFailure(new ApiError("forbidden", 403)), false);
});

test("시작할 때 트리에 있던 문서 id만 모은다(자리표시 행은 뺀다)", () => {
  const known = documentIdsInTree([
    { id: "folder", label: "폴더", type: "folder", children: [{ id: "document-file-old", label: "보고서.md", type: "file", documentId: "old" }] },
    { id: "upload-x", label: "보고서.md", type: "file", status: "failed" }
  ]);
  assert.deepEqual([...known], ["old"]);
});

const NOW = Date.parse("2026-11-11T10:00:00Z");
const serverDoc = (id, name, extra = {}) => ({
  type: "document", id, name,
  document: { id, filename: name, status: "completed", byte_size: 10, mime_type: "text/markdown", uploaded_at: new Date(NOW + 1000).toISOString(), ...extra }
});
const candidate = (key, filename, extra = {}) => ({
  key, folderId: "folder", filename, size: 10, mimeType: "text/markdown", knownDocumentIds: new Set(["old"]), startedAt: NOW, ...extra
});
const tree = (...children) => [{ type: "folder", id: "folder", name: "폴더", children }];

test("결과를 알 수 없던 업로드는 그 뒤 생긴 같은 이름(서버 번호 포함)·같은 크기 문서 하나로 특정될 때만 채택한다", () => {
  const items = [serverDoc("root", "보고서.md"), ...tree(serverDoc("old", "보고서.md"), serverDoc("new", "보고서 (2).md"), serverDoc("draft", "보고서 (초안).md"))];
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md")], new Set()).get("k")?.id, "new");
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md", { folderId: null })], new Set()).get("k")?.id, "root", "올린 폴더 바로 아래만 본다");
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md")], new Set(["new"])).size, 0, "이 페이지가 이미 결과로 받은 문서는 뺀다");
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md", { size: 11 })], new Set()).size, 0, "크기가 다르면 채택하지 않는다");
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md", { mimeType: "application/pdf" })], new Set()).size, 0, "MIME이 둘 다 있고 다르면 채택하지 않는다");
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md", { mimeType: "" })], new Set()).get("k")?.id, "new", "브라우저 MIME이 없으면 비교하지 않는다");
  assert.equal(planUploadAdoptions(items, [candidate("k", "회의록.md")], new Set()).size, 0);
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md", { folderId: "missing" })], new Set()).size, 0);
});

test("시도 전에 올라온 문서(로컬 트리가 오래돼 몰랐던 문서 포함)는 채택하지 않는다", () => {
  const before = new Date(NOW - ADOPTION_CLOCK_SKEW_MS - 1).toISOString();
  const items = tree(serverDoc("stale", "보고서.md", { uploaded_at: before }));
  assert.equal(planUploadAdoptions(items, [candidate("k", "보고서.md")], new Set()).size, 0);
  const withinSkew = tree(serverDoc("skew", "보고서.md", { uploaded_at: new Date(NOW - 1000).toISOString() }));
  assert.equal(planUploadAdoptions(withinSkew, [candidate("k", "보고서.md")], new Set()).get("k")?.id, "skew", "시계 차이만큼은 허용한다");
  assert.equal(planUploadAdoptions(tree(serverDoc("x", "보고서.md", { uploaded_at: undefined })), [candidate("k", "보고서.md")], new Set()).size, 0);
});

test("후보가 여럿이거나 한 문서를 여러 업로드가 가리키면 채택하지 않는다", () => {
  const two = tree(serverDoc("n1", "보고서.md"), serverDoc("n2", "보고서 (2).md"));
  assert.equal(planUploadAdoptions(two, [candidate("k", "보고서.md")], new Set()).size, 0, "같은 업로드의 결과로 볼 문서가 둘");
  const one = tree(serverDoc("n1", "보고서.md"));
  assert.equal(planUploadAdoptions(one, [candidate("a", "보고서.md"), candidate("b", "보고서.md")], new Set()).size, 0, "같은 이름 두 파일");
  const mixed = tree(serverDoc("n1", "a.md"), serverDoc("n2", "a (2).md"));
  const plan = planUploadAdoptions(mixed, [candidate("a", "a.md"), candidate("a2", "a (2).md")], new Set());
  assert.equal(plan.size, 0, "a.md는 두 문서에, a (2).md 문서는 두 업로드에 걸린다");
});
