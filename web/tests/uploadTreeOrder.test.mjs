import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { appendItemsToFolder, applyUploadedDocument } = await import("../src/entities/tree/lib/treeMutations.ts");
const { projectsFromServerTree } = await import("../src/entities/tree/lib/projectsFromServerTree.ts");
const file = (id, label) => ({ id, label, type: "file" });
const labels = (items) => items.map((item) => item.label);

test("루트 업로드는 시작 즉시 이름순이며 완료/서버 갱신 후에도 같은 순서다", () => {
  const original = [file("z", "문서10.pdf")];
  const pending = [ { ...file("upload-2", "문서2.pdf"), status: "uploading" }, { ...file("upload-1", "문서1.pdf"), status: "uploading" } ];
  const started = appendItemsToFolder(original, null, pending);
  assert.deepEqual(labels(started), ["문서1.pdf", "문서2.pdf", "문서10.pdf"]);
  assert.deepEqual(labels(original), ["문서10.pdf"]);
  const completed = applyUploadedDocument(started, "upload-2", { id: "two", filename: "문서2.pdf", status: "completed" });
  assert.deepEqual(labels(completed), labels(started));
  const refreshed = projectsFromServerTree([
    { id: "z", name: "문서10.pdf", type: "file" },
    { id: "two", name: "문서2.pdf", type: "file" }
  ], [{ id: "project-uploaded-documents", title: "문서", items: completed }]);
  assert.deepEqual(labels(refreshed[0].items), labels(started));
});

test("폴더 업로드도 같은 기준을 쓰며 이름이 같은 문서는 폴더보다 앞에 둔다", () => {
  const other = { id: "other", label: "다른 폴더", type: "folder", children: [file("x", "z.md")] };
  const folder = { id: "target", label: "대상", type: "folder", children: [ { id: "nested", label: "노트", type: "folder", children: [] }, file("z", "하나.md") ] };
  const result = appendItemsToFolder([folder, other], "target", [ { ...file("upload-a", "노트.md"), status: "uploading" }, file("upload-b", "가나다.pdf") ]);
  assert.deepEqual(labels(result[0].children), ["가나다.pdf", "노트.md", "노트", "하나.md"]);
  assert.deepEqual(result[1], other);
  assert.equal(folder.children.length, 2);
});
