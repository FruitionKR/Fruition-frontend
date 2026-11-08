import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadMessages } from "./helpers/i18nMessages.mjs";

// 위키 페이지는 LLM이 정리한 내용이라 사용자가 직접 고칠 수 없다. 고치려면 원본 문서를 고쳐 다시 편입하거나 위키 최신화를 쓴다.
const panel = readFileSync(new URL("../src/widgets/source-preview/ui/SourcePreviewPanel.tsx", import.meta.url), "utf8");

test("위키 페이지 화면은 본문을 읽기 전용 Markdown으로만 보여 주고 편집 UI를 쓰지 않는다", () => {
  assert.match(panel, /page\?\.markdown && <MarkdownViewer markdown=\{page\.markdown\} linkPolicy="inert-external" \/>/);
  assert.doesNotMatch(panel, /wiki-page-editing|WikiPageContent|canEditWiki|useWorkspaceRole/);
  assert.equal(existsSync(new URL("../src/features/wiki-page-editing", import.meta.url)), false);
});

test("위키 페이지 편집 문구(편집·저장·충돌·권한 안내)는 ko·en 어디에도 없다", () => {
  for (const locale of ["ko", "en"]) {
    const messages = loadMessages(locale);
    assert.equal(messages.wiki.pageEditing, undefined, `${locale}: wiki.pageEditing`);
    assert.doesNotMatch(JSON.stringify(messages.shared), /wikiPageSaveFailed/, `${locale}: wikiPageSaveFailed`);
  }
});

test("위키 본문 저장 API(saveWikiPageContent)를 더 이상 호출하지 않는다", () => {
  const wikiApi = readFileSync(new URL("../src/entities/wiki/api/wiki.ts", import.meta.url), "utf8");
  assert.doesNotMatch(wikiApi, /saveWikiPageContent|WikiPageVersionConflictError/);
});
