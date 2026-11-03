import assert from "node:assert/strict";
import test from "node:test";
import { ID, PDF, PNG, notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const { readZipArchive, isUnsafeZipPath, ZipSafetyError, MAX_ENTRY_COUNT } = await import("../src/shared/lib/markdown-import/zipArchive.ts");
const { analyzeNotionZip } = await import("../src/features/notion-import/model/analyzeNotionZip.ts");

test("zip 경로 검사: .. ·절대 경로·드라이브 문자를 막는다", () => {
  assert.equal(isUnsafeZipPath("a/b.md"), false);
  assert.equal(isUnsafeZipPath("a/../../b.md"), true);
  assert.equal(isUnsafeZipPath("/etc/passwd"), true);
  assert.equal(isUnsafeZipPath("C:/x.md"), true);
  assert.equal(isUnsafeZipPath("a\\..\\b"), true);
  assert.equal(isUnsafeZipPath("a..b/c.md"), false);
});

test("zip 밖을 가리키는 항목이 있으면 전체를 거절한다", async () => {
  await assert.rejects(readZipArchive(zipFiles({ "ok.md": "x", "../evil.md": "x" })), ZipSafetyError);
});

test("심볼릭 링크 항목을 거절한다", async () => {
  const bytes = zipFiles({ "link.md": ["target.md", { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
  await assert.rejects(readZipArchive(bytes), /심볼릭 링크/);
});

test("압축률이 100:1을 넘는 큰 항목을 거절한다", async () => {
  await assert.rejects(readZipArchive(zipFiles({ "bomb.md": new Uint8Array(4 * 1024 * 1024) })), /압축률/);
  // 작은 파일은 압축률이 높아도 통과한다.
  const { entries } = await readZipArchive(zipFiles({ "small.csv": ",".repeat(50_000) }));
  assert.equal(entries[0].read().length, 50_000);
});

test("항목 수가 상한을 넘으면 거절한다", async () => {
  const files = Object.fromEntries(Array.from({ length: MAX_ENTRY_COUNT + 1 }, (_, index) => [`f${index}.md`, ""]));
  await assert.rejects(readZipArchive(zipFiles(files, { level: 0 })), /10,000개/);
});

test("최상위 Part zip은 한 단계만 풀고, 그 안의 zip은 건너뛴다", async () => {
  const deepest = zipFiles({ "deep.md": "x" });
  const part = zipFiles({ "a.md": "# a", "nested.zip": deepest });
  const { entries, skippedNestedZips } = await readZipArchive(zipFiles({ "Export-1-Part-1.zip": part, "b.md": "# b" }));
  assert.deepEqual(entries.map((entry) => entry.path).sort(), ["a.md", "b.md"]);
  assert.deepEqual(skippedNestedZips, ["nested.zip"]);
  assert.equal(new TextDecoder().decode(entries.find((entry) => entry.path === "a.md").read()), "# a");
});

for (const folderIds of [true, false]) test(`내보내기 zip을 폴더·문서·표·행·이미지·PDF 계획으로 바꾼다(첫 문서 규칙·NFC·중복 이름, 폴더 id ${folderIds ? "있음" : "없음"})`, async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles({ folderIds })));
  const homePage = `홈 ${ID.home}`;
  const home = folderIds ? homePage : "홈";
  const dbDir = folderIds ? `${home}/할일 ${ID.db}` : `${home}/할일`;
  const rowPage = `${dbDir}/행 ${ID.row}`;
  const rowDir = folderIds ? rowPage : `${dbDir}/행`;
  // 데이터베이스와 행 페이지도 하위 페이지와 같은 규칙: 표 문서 옆 같은 이름 폴더에 행 문서, 행 문서 옆 폴더에 그 PDF.
  assert.deepEqual(plan.folders, [
    { key: home, name: "홈", parentKey: null, pageDocumentKey: `${homePage}.md` },
    { key: dbDir, name: "할일", parentKey: home, pageDocumentKey: `${home}/할일 ${ID.db}_all.csv` },
    { key: rowDir, name: "행", parentKey: dbDir, pageDocumentKey: `${rowPage}.md` }
  ]);
  const byKey = (a, b) => (a.key < b.key ? -1 : 1);
  const summary = plan.documents.map(({ key, name, folderKey, kind }) => ({ key, name, folderKey, kind })).sort(byKey);
  assert.deepEqual(summary, [
    { key: `메모 ${ID.memo2}.md`, name: "메모", folderKey: null, kind: "page" },
    { key: `메모 ${ID.memo}.md`, name: "메모 (2)", folderKey: null, kind: "page" },
    // Obsidian처럼 페이지 문서는 같은 이름 폴더의 옆(같은 부모)에 둔다.
    { key: `${homePage}.md`, name: "홈", folderKey: null, kind: "page" },
    { key: `${home}/하위 ${ID.child}.md`, name: "하위", folderKey: home, kind: "page" },
    { key: `${home}/할일 ${ID.db}_all.csv`, name: "할일", folderKey: home, kind: "table" },
    { key: `${rowPage}.md`, name: "행", folderKey: dbDir, kind: "row" }
  ].sort(byKey));
  assert.deepEqual(plan.pdfs.map(({ key, name, folderKey, size }) => ({ key, name, folderKey, size })), [
    { key: `${rowDir}/첨부.pdf`, name: "첨부.pdf", folderKey: rowDir, size: PDF.length }
  ]);
  assert.equal(new TextDecoder().decode(plan.pdfs[0].read()), PDF);
  assert.equal(plan.tableCount, 1);
  assert.equal(plan.rowPageCount, 1);
  assert.equal(plan.imageCount, 1);
  assert.equal(plan.itemCount, 8);
  assert.deepEqual(plan.brokenLinks.map((link) => link.href), [`없음 ${"d".repeat(32)}.md`]);
  assert.deepEqual(plan.skipped.map((item) => item.reason).sort(), [
    "PDF 형식이 아닌 파일",
    "PDF·이미지가 아닌 첨부(PPTX 등)라 가져오지 않음",
    "PNG·JPEG·GIF·WebP가 아닌 이미지"
  ]);

  const table = plan.documents.find((document) => document.kind === "table");
  // 행 페이지가 있는 행의 제목 칸만 그 행 문서 링크가 된다.
  assert.match(table.markdown, /^\| 이름 \| 상태 \| 메모 \|\n\| --- \| --- \| --- \|\n\| 첫 일 \| 완료 \| 쉼표, 있음 \|\n\| \u0000L0\u0000 \| 진행 \|   \|\n$/);
  assert.deepEqual(table.links, [{ text: "행", key: `${rowPage}.md` }]);
  assert.doesNotMatch(table.markdown, /가져오지 않았어요/);

  const row = plan.documents.find((document) => document.kind === "row");
  // 속성 줄은 "속성 | 값" 표가 되고, 속성 값의 Notion 링크와 본문의 PDF 링크는 앱 문서로 잇는다.
  assert.equal(row.markdown, "| 속성 | 값 |\n| --- | --- |\n| 상태 | 완료 |\n| 담당 | \u0000L0\u0000 |\n\n\u0000L1\u0000\n");
  assert.deepEqual(row.links, [{ text: "홈", key: `${homePage}.md` }, { text: "첨부", key: `${rowDir}/첨부.pdf` }]);

  const page = plan.documents.find((document) => document.key === `${homePage}.md`);
  assert.deepEqual(page.links.map((link) => link.key), [`${home}/하위 ${ID.child}.md`, `${home}/할일 ${ID.db}_all.csv`, `${home}/하위 ${ID.child}.md`]);
  assert.equal(plan.notionLinkCount, 2);  // 홈 본문 1개 + 행 속성 값 1개
  assert.match(page.markdown, /\[밖 노션\]\(https:\/\/www\.notion\.so\/Else-9{32}\)/);
  assert.equal(page.images.length, 1);
  assert.equal(page.images[0].mime, "image/png");
  assert.deepEqual([...page.images[0].read()], [...PNG]);
  assert.doesNotMatch(page.markdown, /<script|alert\(1\)|<aside/);
  assert.match(page.markdown, /> 💡 알림/);
  assert.match(page.markdown, /<b>코드 안 HTML<\/b>/);
  assert.match(page.markdown, /^가짜$/m);

  assert.doesNotMatch(page.markdown, /^# 홈/);
  assert.match(page.markdown, /^\[하위\]|^\u0000L0\u0000/);
  const memos = plan.documents.filter((document) => document.name.startsWith("메모"));
  // "메모 (2)"도 중복을 피하기 전 이름이 같으므로 제목을 지우고, 이름과 다른 제목("메모 둘")은 남긴다.
  assert.deepEqual(memos.map((document) => [document.name, document.markdown]), [["메모", "# 메모 둘\n"], ["메모 (2)", ""]]);

  const child = plan.documents.find((document) => document.key.endsWith(`하위 ${ID.child}.md`));
  assert.match(child.markdown, /^\u0000L0\u0000/);
  assert.deepEqual(child.links.map((link) => link.key), [`${homePage}.md`]);
});

test("대상 폴더에 이미 있는 이름과 겹치는 최상위 항목은 번호를 붙인다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()), { folders: ["홈"], documents: ["메모"] });
  assert.equal(plan.folders[0].name, "홈 (2)");
  // 페이지 문서와 그 폴더는 같은 이름을 쓴다(이름 공간이 달라 서버도 함께 둘 수 있다).
  assert.deepEqual(plan.documents.filter((document) => document.folderKey === null).map((document) => document.name), ["메모 (2)", "메모 (3)", "홈 (2)"]);
  // 폴더 첫 문서는 폴더 이름을 따른다.
  assert.equal(plan.documents.find((document) => document.key === `홈 ${ID.home}.md`).name, "홈 (2)");
});

test("페이지 문서와 폴더는 같은 이름으로 짝을 맞추고, 문서는 문서끼리·폴더는 폴더끼리만 겹침을 피한다", async () => {
  // 같은 위치의 기존 문서 "홈"만 있어도 짝 이름을 함께 바꾼다.
  const onlyDocument = await analyzeNotionZip(zipFiles(notionExportFiles()), { folders: [], documents: ["홈"] });
  assert.equal(onlyDocument.folders[0].name, "홈 (2)");
  assert.equal(onlyDocument.documents.find((document) => document.key === `홈 ${ID.home}.md`).name, "홈 (2)");
  // 하위 페이지 없는 문서는 같은 이름의 기존 폴더가 있어도 이름을 그대로 쓴다.
  const plain = await analyzeNotionZip(zipFiles({ [`메모 ${ID.memo}.md`]: "본문" }), { folders: ["메모"], documents: [] });
  assert.equal(plain.documents[0].name, "메모");
});

test("부모 본문에 링크가 없는 하위 페이지는 맨 끝 '하위 페이지' 목록에 링크로 붙인다", async () => {
  const plan = await analyzeNotionZip(zipFiles({
    [`부모 ${ID.home}.md`]: `# 부모\n\n[첫째](${encodeURIComponent(`부모/첫째 ${ID.child}.md`)})\n`,
    [`부모/첫째 ${ID.child}.md`]: "# 첫째\n",
    [`부모/둘째 ${ID.memo}.md`]: "# 둘째\n",
    [`부모/표 ${ID.db}.csv`]: "a\n1\n"
  }));
  assert.deepEqual(plan.folders.map(({ key, name, parentKey }) => ({ key, name, parentKey })), [{ key: "부모", name: "부모", parentKey: null }]);
  const parent = plan.documents.find((document) => document.name === "부모");
  assert.equal(parent.folderKey, null);
  assert.deepEqual(parent.links.map((link) => [link.text, link.key]), [
    ["첫째", `부모/첫째 ${ID.child}.md`],
    ["둘째", `부모/둘째 ${ID.memo}.md`],
    ["표", `부모/표 ${ID.db}.csv`]
  ]);
  assert.match(parent.markdown, /\n## 하위 페이지\n\n- \u0000L1\u0000\n- \u0000L2\u0000\n$/);
});

test("하위 페이지 없이 이미지만 있는 페이지는 폴더를 만들지 않는다", async () => {
  const plan = await analyzeNotionZip(zipFiles({ "p.md": "![a](p/a.png)", "p/a.png": PNG }));
  assert.deepEqual(plan.folders, []);
  assert.equal(plan.documents[0].folderKey, null);
  assert.equal(plan.imageCount, 1);
});

test("이미지 형식 확인은 압축을 끝까지 풀지 않고 앞부분만 읽는다", async () => {
  const image = new Uint8Array(300_000);
  image.set(PNG);
  for (let index = PNG.length; index < image.length; index += 1) image[index] = (index * 7919) % 251;
  const { entries } = await readZipArchive(zipFiles({ "a.png": image, "b.png": [image, { level: 0 }] }));
  for (const entry of entries) assert.deepEqual([...entry.readHead(16)], [...PNG]);
});

test("행 페이지는 CSV 제목(첫 열)과 맞춰 센다: 파일 이름이 바뀐 제목은 본문 H1로 맞추고, CSV에 없는 페이지는 일반 하위 페이지다", async () => {
  const plan = await analyzeNotionZip(zipFiles({
    [`DB ${ID.db}_all.csv`]: "이름,값\n창업톤(L:AUNCH),1\n없는 행,2\n둘,3\n",
    // Notion은 파일 이름의 ':'를 공백으로 바꾼다.
    [`DB/창업톤(L AUNCH) ${ID.row}.md`]: "# 창업톤(L:AUNCH)\n\n값: 1\n",
    [`DB/둘 ${ID.memo}.md`]: "# 둘\n",
    [`DB/메모만 ${ID.memo2}.md`]: "# 메모만\n\n속성: 아님\n"
  }));
  const kinds = Object.fromEntries(plan.documents.map((document) => [document.name, document.kind]));
  assert.deepEqual(kinds, { "DB": "table", "창업톤(L AUNCH)": "row", "둘": "row", "메모만": "page" });
  assert.equal(plan.rowPageCount, 2);
  // 일반 페이지의 `이름: 값` 줄은 속성 표로 바꾸지 않는다.
  assert.equal(plan.documents.find((document) => document.name === "메모만").markdown, "속성: 아님\n");
  const table = plan.documents.find((document) => document.kind === "table");
  assert.deepEqual(table.links.map((link) => [link.text, link.key]), [
    ["창업톤(L:AUNCH)", `DB/창업톤(L AUNCH) ${ID.row}.md`],
    ["둘", `DB/둘 ${ID.memo}.md`]
  ]);
  assert.match(table.markdown, /\| 없는 행 \| 2 \|/);
});

test("표 칸의 관계(상대 경로)·Notion 링크를 앱 문서 링크로 바꾸고, 밖을 가리키는 Notion 링크는 그대로 둔다", async () => {
  const plan = await analyzeNotionZip(zipFiles({
    [`DB ${ID.db}.csv`]: `이름,관계,소속\n가,"페이지 (${encodeURIComponent(`페이지 ${ID.home}.md`)}), 남 (https://www.notion.so/x-${ID.child})",밖 (https://app.notion.com/p/${"9".repeat(32)}?pvs=21)\n`,
    [`페이지 ${ID.home}.md`]: "# 페이지\n",
    [`남 ${ID.child}.md`]: "# 남\n"
  }));
  const table = plan.documents.find((document) => document.kind === "table");
  assert.deepEqual(table.links.map((link) => [link.text, link.key]), [["페이지", `페이지 ${ID.home}.md`], ["남", `남 ${ID.child}.md`]]);
  assert.match(table.markdown, /\| 가 \| \u0000L0\u0000, \u0000L1\u0000 \| \[밖\]\(https:\/\/app\.notion\.com\/p\/9{32}\?pvs=21\) \|/);
});

test("행 페이지 안의 데이터베이스도 같은 규칙으로 표 문서와 폴더가 된다(재귀)", async () => {
  const plan = await analyzeNotionZip(zipFiles({
    [`프로젝트 ${ID.db}_all.csv`]: "이름\n앱\n",
    [`프로젝트/앱 ${ID.row}.md`]: `# 앱\n\n[작업](${encodeURIComponent(`앱/작업 ${ID.memo}.csv`)})\n`,
    [`프로젝트/앱/작업 ${ID.memo}_all.csv`]: "이름\n설계\n",
    [`프로젝트/앱/작업/설계 ${ID.child}.md`]: "# 설계\n\n상태: 끝\n"
  }));
  assert.deepEqual(plan.folders.map(({ key, name, parentKey }) => [key, name, parentKey]), [
    ["프로젝트", "프로젝트", null],
    ["프로젝트/앱", "앱", "프로젝트"],
    ["프로젝트/앱/작업", "작업", "프로젝트/앱"]
  ]);
  assert.deepEqual(plan.documents.map(({ name, kind, folderKey }) => [name, kind, folderKey]).sort(), [
    ["설계", "row", "프로젝트/앱/작업"],
    ["앱", "row", "프로젝트"],
    ["작업", "table", "프로젝트/앱"],
    ["프로젝트", "table", null]
  ]);
  assert.equal(plan.rowPageCount, 2);
});

test("PDF는 %PDF- 로 시작하고 100MB 이하일 때만 PDF 문서로 올리고, 확인은 앞부분만 읽는다", async () => {
  const { buildImportPlan, PDF_MAX_BYTES } = await import("../src/features/notion-import/lib/notionPlan.ts");
  const file = (path, size, head) => ({
    path,
    size,
    read: () => { throw new Error(`${path} 전체를 읽으면 안 된다`); },
    readHead: (length) => new TextEncoder().encode(head).slice(0, length)
  });
  const plan = await buildImportPlan([
    { path: "p.md", size: 30, read: () => new TextEncoder().encode("[자료](p/a.pdf) [큰](p/big.pdf)") },
    file("p/a.pdf", 10, "%PDF-1.7"),
    file("p/big.pdf", PDF_MAX_BYTES + 1, "%PDF-1.7"),
    file("p/fake.pdf", 10, "<html>"),
    file("p/deck.pptx", 10, "PK")
  ]);
  assert.deepEqual(plan.pdfs.map((pdf) => [pdf.key, pdf.folderKey]), [["p/a.pdf", "p"]]);
  // PDF가 든 페이지 폴더는 하위 페이지처럼 페이지 옆 같은 이름 폴더가 된다.
  assert.deepEqual(plan.folders, [{ key: "p", name: "p", parentKey: null, pageDocumentKey: "p.md" }]);
  assert.deepEqual(plan.skipped.map((item) => [item.path, item.reason]), [
    ["p/big.pdf", "100MB를 넘는 PDF"],
    ["p/fake.pdf", "PDF 형식이 아닌 파일"],
    ["p/deck.pptx", "PDF·이미지가 아닌 첨부(PPTX 등)라 가져오지 않음"]
  ]);
  const page = plan.documents[0];
  assert.deepEqual(page.links, [{ text: "자료", key: "p/a.pdf" }]);
  assert.match(page.markdown, /^\u0000L0\u0000 큰/);
  assert.equal(plan.totalBytes, page.bytes + 10);
});
