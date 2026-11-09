import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { conversionFolderPlan } = await import("../src/entities/tree/lib/conversionFolder.ts");
const pdf = { id: "pdf", type: "document", name: "자료.pdf" };
const md = { id: "md", type: "document", name: "자료.md", document: { source_document_id: "pdf" } };
test("원본 이름으로 새 실제 폴더를 계획하고 같은 위치의 변환본을 포함한다", () => {
  assert.deepEqual(conversionFolderPlan([pdf, md], "pdf"), { folderId: null, parentId: null, name: "자료", memberIds: ["pdf", "md"] });
});
test("동명 폴더는 합치지 않으며 다른 폴더로 정리한 변환본도 이동하지 않는다", () => {
  const tree = [pdf, { id: "other", type: "folder", name: "자료", children: [md] }];
  assert.deepEqual(conversionFolderPlan(tree, "pdf"), { folderId: null, parentId: null, name: "자료 (2)", memberIds: ["pdf"] });
});
test("재변환은 이름을 바꾼 전용 폴더도 재사용한다", () => {
  const tree = [{ id: "folder", type: "folder", name: "정리한 자료", children: [pdf, md] }];
  assert.equal(conversionFolderPlan(tree, "pdf").folderId, "folder");
});
test("원본 이동 뒤 변환이 실패해도 같은 폴더에서 다시 시도한다", () => {
  assert.equal(conversionFolderPlan([{ id: "folder", type: "folder", name: "자료", children: [pdf] }], "pdf").folderId, "folder");
});
test("일반 폴더 안에서는 해당 PDF만 담을 하위 폴더를 만든다", () => {
  const plan = conversionFolderPlan([{ id: "folder", type: "folder", name: "리서치", children: [pdf, md, { id: "memo", type: "document", name: "메모.md" }] }], "pdf");
  assert.equal(plan.folderId, null); assert.equal(plan.parentId, "folder");
});
