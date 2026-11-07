import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { ko } = await import("./fakeNextIntl.mjs");

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("변환 품질 안내는 원본 PDF와 다를 수 있고 가독성이 떨어질 수 있다고 알린다", () => {
  const notice = ko("wiki.ingest.pdfConvertQualityNotice");
  assert.match(notice, /원본 PDF와 .*일치하지 않을 수 있/);
  assert.match(notice, /가독성이 떨어질 수 있/);
  // 위키 편입 확인창은 안내를 문구 안에 함께 싣는다.
  assert.ok(ko("wiki.ingest.pdfConvertConfirm.description", { filename: "a.pdf", qualityNotice: notice }).includes(notice));
  assert.ok(ko("wiki.ingest.pdfIngestConfirm.description", { count: 2, qualityNotice: notice }).includes(notice));
});

test("변환을 시작하는 확인 화면은 모두 변환 품질 안내를 보여 준다(트리 메뉴·변환 후 편입·Notion 가져오기)", async () => {
  const [convertModal, ingestModal, notionDialog, home] = await Promise.all([
    source("../src/features/wiki-ingest/ui/PdfConvertConfirmModal.tsx"),
    source("../src/features/wiki-ingest/ui/PdfIngestConfirmModal.tsx"),
    source("../src/features/notion-import/ui/NotionImportDialog.tsx"),
    source("../src/widgets/workspace/ui/HomeWorkspace.tsx")
  ]);
  for (const text of [convertModal, ingestModal]) assert.match(text, /t\("pdfConvertQualityNotice"\)/);
  // Notion 가져오기는 notionImport 메시지에 같은 안내를 두고 화면 언어로 보여 준다.
  assert.match(notionDialog, /t\("convert\.qualityNotice"\)/);
  const [notionKo, notionEn] = await Promise.all(["ko", "en"].map(async (locale) => JSON.parse(await source(`../src/shared/i18n/messages/${locale}/notionImport.json`))));
  const wikiEn = JSON.parse(await source("../src/shared/i18n/messages/en/wiki.json"));
  assert.equal(notionKo.convert.qualityNotice, ko("wiki.ingest.pdfConvertQualityNotice"));
  assert.equal(notionEn.convert.qualityNotice, wikiEn.ingest.pdfConvertQualityNotice);
  assert.match(convertModal, /confirmLabel=\{t\("confirm"\)\}/);
  // 트리 메뉴의 변환은 확인 모달의 확인 버튼으로만 시작한다.
  assert.match(home, /<PdfConvertConfirmModal[\s\S]*?onConfirm=\{projectTree\.confirmConvert\}[\s\S]*?onCancel=\{projectTree\.cancelConvert\}/);
});
