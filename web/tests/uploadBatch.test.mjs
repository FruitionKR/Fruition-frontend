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
const { documentIdsInTree, findCreatedUpload, isAmbiguousUploadFailure, runUploadBatch } = await import("../src/features/document-upload/model/uploadBatch.ts");

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

test("결과를 알 수 없던 업로드가 서버에 만들어졌으면 다시 올리기 전에 그 문서를 찾는다", () => {
  const known = documentIdsInTree([
    { id: "folder", label: "폴더", type: "folder", children: [{ id: "document-file-old", label: "보고서.md", type: "file", documentId: "old" }] },
    { id: "upload-x", label: "보고서.md", type: "file", status: "failed" }
  ]);
  assert.deepEqual([...known], ["old"]);
  const doc = (id, name) => ({ type: "document", id, name, document: { id, filename: name, status: "completed" } });
  const tree = [
    doc("root-new", "보고서.md"),
    { type: "folder", id: "folder", name: "폴더", children: [doc("old", "보고서.md"), doc("new", "보고서 (2).md"), doc("other", "보고서 (초안).md")] }
  ];

  assert.equal(findCreatedUpload(tree, "folder", "보고서.md", known)?.id, "new", "서버가 번호를 붙인 새 문서를 찾는다");
  assert.equal(findCreatedUpload(tree, null, "보고서.md", known)?.id, "root-new", "올린 폴더 바로 아래만 본다");
  assert.equal(findCreatedUpload(tree, "folder", "보고서.md", new Set(["old", "new"])), undefined, "업로드 전부터 있던 문서는 결과로 쓰지 않는다");
  assert.equal(findCreatedUpload(tree, "folder", "회의록.md", known), undefined);
  assert.equal(findCreatedUpload(tree, "missing", "보고서.md", known), undefined);
});
