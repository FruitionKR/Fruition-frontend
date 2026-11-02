import assert from "node:assert/strict";
import test from "node:test";
import { ID, PNG, notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const { readZipArchive, isUnsafeZipPath, ZipSafetyError, MAX_ENTRY_COUNT } = await import("../src/features/notion-import/lib/zipArchive.ts");
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

test("내보내기 zip을 폴더·문서·표·이미지 계획으로 바꾼다(첫 문서 규칙·행 건너뜀·NFC·중복 이름)", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const home = `홈 ${ID.home}`;
  assert.deepEqual(plan.folders, [{ key: home, name: "홈", parentKey: null }]);
  const summary = plan.documents.map(({ key, name, folderKey, kind }) => ({ key, name, folderKey, kind }));
  assert.deepEqual(summary, [
    { key: `메모 ${ID.memo2}.md`, name: "메모", folderKey: null, kind: "page" },
    { key: `메모 ${ID.memo}.md`, name: "메모 (2)", folderKey: null, kind: "page" },
    { key: `${home}.md`, name: "홈", folderKey: home, kind: "page" },
    { key: `${home}/하위 ${ID.child}.md`, name: "하위", folderKey: home, kind: "page" },
    { key: `${home}/할일 ${ID.db}_all.csv`, name: "할일", folderKey: home, kind: "table" }
  ]);
  assert.equal(plan.tableCount, 1);
  assert.equal(plan.imageCount, 1);
  assert.equal(plan.itemCount, 6);
  assert.equal(plan.skippedRowPages, 1);
  assert.deepEqual(plan.brokenLinks.map((link) => link.href), [`없음 ${"d".repeat(32)}.md`]);
  assert.deepEqual(plan.skipped.map((item) => item.reason).sort(), [
    "PNG·JPEG·GIF·WebP가 아닌 이미지",
    "데이터베이스 행 페이지의 첨부",
    "지원하지 않는 첨부 파일"
  ]);

  const table = plan.documents.find((document) => document.kind === "table");
  assert.match(table.markdown, /\| 이름 \| 상태 \| 메모 \|\n\| --- \| --- \| --- \|\n\| 첫 일 \| 완료 \| 쉼표, 있음 \|/);
  assert.match(table.markdown, /행의 페이지 본문은 가져오지 않았어요/);

  const page = plan.documents.find((document) => document.key === `${home}.md`);
  assert.deepEqual(page.links.map((link) => link.key), [`${home}/하위 ${ID.child}.md`, `${home}/할일 ${ID.db}_all.csv`]);
  assert.equal(page.images.length, 1);
  assert.equal(page.images[0].mime, "image/png");
  assert.deepEqual([...page.images[0].read()], [...PNG]);
  assert.doesNotMatch(page.markdown, /<script|alert\(1\)|<aside/);
  assert.match(page.markdown, /> 💡 알림/);
  assert.match(page.markdown, /<b>코드 안 HTML<\/b>/);
  assert.match(page.markdown, /^가짜$/m);

  const child = plan.documents.find((document) => document.key.endsWith(`하위 ${ID.child}.md`));
  assert.deepEqual(child.links.map((link) => link.key), [`${home}.md`]);
});

test("대상 폴더에 이미 있는 이름과 겹치는 최상위 항목은 번호를 붙인다", async () => {
  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()), { folders: ["홈"], documents: ["메모"] });
  assert.equal(plan.folders[0].name, "홈 (2)");
  assert.deepEqual(plan.documents.filter((document) => document.folderKey === null).map((document) => document.name), ["메모 (2)", "메모 (3)"]);
  // 폴더 첫 문서는 폴더 이름을 따른다.
  assert.equal(plan.documents.find((document) => document.key === `홈 ${ID.home}.md`).name, "홈 (2)");
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
