import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { PDF_CONVERT_QUALITY_NOTICE } = await import("../src/entities/document/lib/documentConversion.ts");

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("변환 품질 안내는 원본 PDF와 다를 수 있고 가독성이 떨어질 수 있다고 알린다", () => {
  assert.match(PDF_CONVERT_QUALITY_NOTICE, /원본 PDF와 .*일치하지 않을 수 있/);
  assert.match(PDF_CONVERT_QUALITY_NOTICE, /가독성이 떨어질 수 있/);
});

test("변환을 시작하는 확인 화면은 모두 변환 품질 안내를 보여 준다(트리 메뉴·변환 후 편입·Notion 가져오기)", async () => {
  const [convertModal, ingestModal, notionDialog, home] = await Promise.all([
    source("../src/features/wiki-ingest/ui/PdfConvertConfirmModal.tsx"),
    source("../src/features/wiki-ingest/ui/PdfIngestConfirmModal.tsx"),
    source("../src/features/notion-import/ui/NotionImportDialog.tsx"),
    source("../src/widgets/workspace/ui/HomeWorkspace.tsx")
  ]);
  for (const text of [convertModal, ingestModal, notionDialog]) assert.match(text, /PDF_CONVERT_QUALITY_NOTICE/);
  assert.match(convertModal, /confirmLabel="확인"/);
  // 트리 메뉴의 변환은 확인 모달의 확인 버튼으로만 시작한다.
  assert.match(home, /<PdfConvertConfirmModal[\s\S]*?onConfirm=\{projectTree\.confirmConvert\}[\s\S]*?onCancel=\{projectTree\.cancelConvert\}/);
});
