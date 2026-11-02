import assert from "node:assert/strict";
import test from "node:test";
import { registerSrcHooks } from "./notionImportFixture.mjs";

registerSrcHooks();
const { cleanNotionName, uniqueName, splitExtension } = await import("../src/features/notion-import/lib/notionNames.ts");
const { parseCsv, csvToMarkdownTable, escapeTableCell } = await import("../src/features/notion-import/lib/csvTable.ts");
const { sanitizeNotionMarkdown } = await import("../src/features/notion-import/lib/notionHtml.ts");
const { resolveRelativeLink, tokenizeLinks, renderLinks, renderImages, documentHref } = await import("../src/features/notion-import/lib/notionLinks.ts");
const { planAttachmentBatches } = await import("../src/features/notion-import/lib/attachmentBatches.ts");

const HEX = "0123456789abcdef0123456789abcdef";

test("이름 끝 32자리 hex id를 떼고 NFC로 맞춘다", () => {
  assert.equal(cleanNotionName(`회의록 ${HEX}`), "회의록");
  assert.equal(cleanNotionName(`회의록 ${HEX}`.normalize("NFD")), "회의록");
  assert.equal(cleanNotionName(`회의록 ${HEX}`.normalize("NFD")).length, 3);
  // 32자리가 아니거나 공백이 없으면 이름의 일부다.
  assert.equal(cleanNotionName("버전 abc123"), "버전 abc123");
  assert.equal(cleanNotionName(`이름${HEX}`), `이름${HEX}`);
  assert.equal(cleanNotionName(` ${HEX}`), "제목 없음");
  assert.deepEqual(splitExtension(`페이지 ${HEX}.MD`), { base: `페이지 ${HEX}`, extension: ".md" });
});

test("같은 폴더의 같은 이름은 (2), (3)을 붙이고 대소문자·정규화 차이도 같은 이름으로 본다", () => {
  const taken = new Set();
  assert.equal(uniqueName("메모", taken), "메모");
  assert.equal(uniqueName("메모", taken), "메모 (2)");
  assert.equal(uniqueName("메모".normalize("NFD"), taken), "메모".normalize("NFD") + " (3)");
  assert.equal(uniqueName("Note", taken), "Note");
  assert.equal(uniqueName("note", taken), "note (2)");
});

test("CSV: 따옴표 안 쉼표·줄바꿈·\"\" 이스케이프와 BOM·CRLF를 처리한다", () => {
  assert.deepEqual(parseCsv("﻿a,b\r\n\"x, y\",\"줄\n바꿈\"\r\n\"say \"\"hi\"\"\",\n"), [
    ["a", "b"],
    ["x, y", "줄\n바꿈"],
    ["say \"hi\"", ""]
  ]);
});

test("CSV를 GFM 표로 바꾸며 | 와 \\ 를 이스케이프하고 짧은 행은 채운다", () => {
  assert.equal(escapeTableCell("a|b\\c\nd"), "a\\|b\\\\c d");
  assert.equal(csvToMarkdownTable("이름,값,비고\n\"a|b\",\"1\n2\"\n"), [
    "| 이름 | 값 | 비고 |",
    "| --- | --- | --- |",
    "| a\\|b | 1 2 |   |"
  ].join("\n"));
  assert.equal(csvToMarkdownTable(""), "");
});

test("콜아웃·토글 HTML은 인용문으로, script·이벤트 속성은 지우고 코드 안은 그대로 둔다", () => {
  const input = [
    "<aside>💡 <strong>알림</strong> 내용<br>둘째 줄</aside>",
    "<details><summary>토글 제목</summary><p>토글 내용</p></details>",
    "<img src=x onerror=\"alert(1)\">텍스트<script>alert(2)</script><style>a{}</style>",
    "`<b>인라인</b>`",
    "```html",
    "<script>그대로</script>",
    "```"
  ].join("\n");
  const output = sanitizeNotionMarkdown(input);
  assert.match(output, /^> 💡 알림 내용\n> 둘째 줄$/m);
  assert.match(output, /^> \*\*토글 제목\*\*\n> 토글 내용$/m);
  assert.doesNotMatch(output.replace(/```html[\s\S]*```/, ""), /<script|onerror|alert\(2\)|<img|<style/);
  assert.match(output, /^텍스트$/m);
  assert.match(output, /`<b>인라인<\/b>`/);
  assert.match(output, /```html\n<script>그대로<\/script>\n```/);
});

test("상대 링크: URL 인코딩·../·앵커·외부 주소를 구분한다", () => {
  assert.equal(resolveRelativeLink("홈/하위.md", "%EC%86%90%EC%9E%90%20x.md"), "홈/손자 x.md");
  assert.equal(resolveRelativeLink("홈/하위.md", "../%ED%99%88.md#heading"), "홈.md");
  assert.equal(resolveRelativeLink("a.md", "./b/c.md?x=1"), "b/c.md");
  assert.equal(resolveRelativeLink("a.md", "../../evil.md"), null);
  assert.equal(resolveRelativeLink("a.md", "#section"), null);
  assert.equal(resolveRelativeLink("a.md", "https://notion.so/x"), null);
  assert.equal(resolveRelativeLink("a.md", "mailto:a@b.c"), null);
  assert.equal(resolveRelativeLink("a.md", "/abs.md"), null);
  // NFD로 인코딩된 링크도 NFC 경로로 맞춘다.
  assert.equal(resolveRelativeLink("a.md", encodeURIComponent("메모.md".normalize("NFD"))), "메모.md");
});

test("링크·이미지를 토큰으로 바꾸고 문서 ID·첨부 경로로 채운다", () => {
  const markdown = "[하위](sub%20x.md) [표](db.csv) ![그림](img.png) ![그림](img.png) [밖](https://e.com) [없음](none.md) `[코드](sub%20x.md)`";
  const resolve = (path, isImage) => path === "sub x.md" ? { kind: "document", key: "sub x.md" }
    : path === "db.csv" ? { kind: "document", key: "db.csv" }
      : isImage && path === "img.png" ? { kind: "image", path } : { kind: "broken" };
  const tokenized = tokenizeLinks(markdown, "page.md", resolve);
  assert.equal(tokenized.links.length, 2);
  assert.deepEqual(tokenized.images, [{ path: "img.png", alt: "그림" }]);
  assert.deepEqual(tokenized.broken, ["none.md"]);
  const ids = new Map([["sub x.md", "doc_1"]]);
  const linked = renderLinks(tokenized.markdown, tokenized.links, (key) => ids.get(key));
  // ID가 없는 대상(표 생성 실패 등)은 글자만 남는다.
  assert.equal(
    renderImages(linked, tokenized.images, () => "/api/workspaces/ws_1/assets/a1/content"),
    "[하위](/home?doc=doc_1) 표 ![그림](/api/workspaces/ws_1/assets/a1/content) ![그림](/api/workspaces/ws_1/assets/a1/content) [밖](https://e.com) 없음 `[코드](sub%20x.md)`"
  );
  // 다음 저장으로 미룬 이미지는 아직 넣지 않는다.
  assert.equal(renderImages("a \u0000I0\u0000 b", tokenized.images, () => null), "a  b");
  assert.equal(documentHref("doc 1"), "/home?doc=doc%201");
});

test("첨부 묶음: 20개·요청 100MB를 넘지 않게 순서대로 나눈다", () => {
  const MIB = 1024 * 1024;
  assert.deepEqual(planAttachmentBatches([]), []);
  const many = planAttachmentBatches(Array.from({ length: 45 }, () => 1000));
  assert.deepEqual(many.map((batch) => batch.length), [20, 20, 5]);
  assert.deepEqual(many.flat(), Array.from({ length: 45 }, (_, index) => index));
  const big = planAttachmentBatches(Array.from({ length: 12 }, () => 9 * MIB), { markdownBytes: 2 * MIB });
  assert.deepEqual(big.map((batch) => batch.length), [10, 2]);
});
