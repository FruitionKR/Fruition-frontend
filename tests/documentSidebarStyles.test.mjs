import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarStyles = readFileSync(
  new URL("../src/widgets/document-sidebar/ui/DocumentSidebar.module.css", import.meta.url),
  "utf8"
);

test("업로드 중 자리표시 행은 흐리게 표시하고 클릭 커서를 진행 중으로 바꾼다", () => {
  assert.match(sidebarStyles, /\.tree-row\.is-uploading\s*\{[^}]*cursor:\s*progress;/s);
  assert.match(sidebarStyles, /\.tree-upload-spinner\s*\{[^}]*animation:[^}]*infinite;/s);
});

test("루트 트리는 빈 여백에 항목을 끌어다 놓을 때 루트 이동 표시를 그린다", () => {
  assert.match(sidebarStyles, /\.tree-root\.is-tree-drop-target::after\s*\{[^}]*border:[^}]*dashed/s);
  assert.doesNotMatch(sidebarStyles, /\.project-section\b/);
});
