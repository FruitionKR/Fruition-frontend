import assert from "node:assert/strict";
import test from "node:test";
import { ID, PNG, notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const {
  countMissingImages, createImageResolver, findImageRefs, looksLikeNotionExport, planMarkdownBundle, rewriteImageRefs
} = await import("../src/features/document-upload/lib/markdownBundle.ts");
const { uploadMarkdownBundleDocument } = await import("../src/features/document-upload/model/markdownBundleUpload.ts");
const { bundleFromZip, bundleFilesFromSelection } = await import("../src/features/document-upload/model/markdownBundleSources.ts");
const { ZipSafetyError } = await import("../src/shared/lib/markdown-import/zipArchive.ts");

const encoder = new TextEncoder();
const bundleFile = (path, content) => {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  return { path, size: bytes.length, read: async () => bytes };
};

test("상대 그림 주소만 찾고 외부 주소·data:·코드 안은 건너뛴다", () => {
  const markdown = [
    "![그림 1](fig1.png) ![같은 그림](./fig1.png)",
    '<img src="images/a.png" width="10"> <img src=\'https://cdn.example.com/x.png\'>',
    "![외부](https://example.com/b.png) ![데이터](data:image/png;base64,AAAA) ![절대](/c.png)",
    "![인코딩](%EA%B7%B8%EB%A6%BC%20%EB%91%98.png)",
    "`![코드](code.png)`",
    "```",
    "![펜스](fence.png)",
    "```"
  ].join("\n");

  assert.deepEqual(findImageRefs(markdown, "docs/note.md"), ["docs/fig1.png", "docs/그림 둘.png", "docs/images/a.png"]);
});

test("빠진 그림 수: 함께 받은 그림은 경로·대소문자·NFC·이름으로 맞춘다", () => {
  const markdown = "![](Images/FIG1.PNG) ![](images/a.png) ![](missing.png) ![](%ED%95%9C%EA%B8%80.png)";
  const nfd = "한글.png".normalize("NFD");

  assert.equal(countMissingImages(markdown, "note.md"), 4);
  assert.equal(countMissingImages(markdown, "note.md", [bundleFile("images/fig1.png", PNG), bundleFile("a.png", PNG), bundleFile(nfd.normalize("NFC"), PNG)]), 1);
});

test("이름이 같은 그림이 여럿이면 이름만으로는 맞추지 않는다", () => {
  const resolve = createImageResolver([bundleFile("x/a.png", PNG), bundleFile("y/a.png", PNG)]);

  assert.equal(resolve("z/a.png"), null);
  assert.equal(resolve("Y/A.png").path, "y/a.png");
});

test("그림 주소 바꾸기는 Markdown·HTML 그림 모두 바꾸고 replace가 null이면 그대로 둔다", () => {
  const markdown = '![a](fig1.png "제목") <img alt="b" src="fig2.png"> ![c](fig3.png)';

  const rewritten = rewriteImageRefs(markdown, "note.md", (ref) => (ref === "fig3.png" ? null : `attachment://${ref}`));

  assert.equal(rewritten, '![a](attachment://fig1.png "제목") <img alt="b" src="attachment://fig2.png"> ![c](fig3.png)');
});

test("묶음 계획: .md마다 쓰는 그림과 빠진 그림을 나누고 쓰지 않는 그림을 모은다", async () => {
  const plan = await planMarkdownBundle([
    bundleFile("a.md", "![](fig1.png) ![](gone.png)"),
    bundleFile("b.md", "본문만"),
    bundleFile("fig1.png", PNG),
    bundleFile("extra.png", PNG)
  ]);

  assert.deepEqual(plan.documents.map((document) => [document.file.path, document.images.map(({ ref }) => ref), document.missing]), [
    ["a.md", ["fig1.png"], ["gone.png"]],
    ["b.md", [], []]
  ]);
  assert.deepEqual(plan.unused.map((file) => file.path), ["extra.png"]);
});

test("Notion 내보내기는 이름 끝 id나 Export 묶음으로 알아본다", () => {
  assert.equal(looksLikeNotionExport([`Export-1/홈 ${ID.home}.md`]), true);
  assert.equal(looksLikeNotionExport(["Export-abc-Part-1.zip"]), true);
  assert.equal(looksLikeNotionExport(["report/report.md", "report/images/fig1.png"]), false);
});

test("zip: Notion이 아니면 Markdown·그림만 묶음으로 쓰고, Notion zip은 따로 알린다", async () => {
  const plain = new File([zipFiles({ "report/report.md": "![](images/fig1.png)", "report/images/fig1.png": PNG, "report/notes.txt": "x" })], "report.zip");
  const notion = new File([zipFiles(notionExportFiles())], "notion.zip");

  const bundle = await bundleFromZip(plain);
  assert.equal(bundle.kind, "bundle");
  assert.deepEqual(bundle.files.map((file) => file.path), ["report/report.md", "report/images/fig1.png"]);
  assert.deepEqual((await bundleFromZip(notion)).kind, "notion");
});

test("zip 안전 검사(밖을 가리키는 경로)는 Notion 가져오기와 같은 오류로 거절한다", async () => {
  const unsafe = new File([zipFiles({ "../evil.md": "x" })], "evil.zip");

  await assert.rejects(() => bundleFromZip(unsafe), ZipSafetyError);
});

test("고른 파일은 Markdown·그림만 묶음에 넣고 경로는 NFC 이름이다", () => {
  const files = bundleFilesFromSelection([
    new File(["# a"], "노트.md".normalize("NFD")),
    new File([PNG], "fig1.png"),
    new File(["%PDF"], "doc.pdf")
  ]);

  assert.deepEqual(files.map((file) => file.path), ["노트.md", "fig1.png"]);
});

function fakeWriter({ failOnSave = -1 } = {}) {
  const saves = [];
  return {
    saves,
    uploadMarkdown: async (file) => ({ id: "doc_1", current_version: 1, uploadedText: await file.text() }),
    saveContent: async (documentId, markdown, baseVersion, attachments) => {
      if (saves.length === failOnSave) throw Object.assign(new Error("저장 공간이 부족해요."), { code: "STORAGE_QUOTA_EXCEEDED" });
      saves.push({ documentId, markdown, baseVersion, ids: attachments.map(({ id }) => id), types: attachments.map(({ file }) => file.type) });
      return {
        content_version: baseVersion + 1,
        attachments: attachments.map(({ id }) => ({ attachment_id: id.toUpperCase(), content_path: `/assets/${id}` }))
      };
    }
  };
}

function numberedIds() {
  let next = 0;
  return () => `id${String(next++).padStart(2, "0")}`;
}

test("그림 25개는 20개·5개로 나눠 저장하고, 두 번째 저장은 앞 묶음을 서버 경로로 쓴다", async () => {
  const names = Array.from({ length: 25 }, (_, index) => `f${index}.png`);
  const markdown = names.map((name) => `![](${name})`).join("\n");
  const document = {
    file: bundleFile("note.md", markdown),
    markdown,
    images: names.map((name) => ({ ref: name, file: bundleFile(name, PNG) })),
    missing: []
  };
  const writer = fakeWriter();

  const result = await uploadMarkdownBundleDocument(document, writer, numberedIds());

  assert.equal(result.created.id, "doc_1");
  assert.equal(result.created.uploadedText, markdown);
  assert.equal(result.attached, 25);
  assert.equal(result.failed, null);
  assert.deepEqual(writer.saves.map((save) => [save.ids.length, save.baseVersion]), [[20, 1], [5, 2]]);
  assert.ok(writer.saves[0].markdown.startsWith("![](attachment://id00)"));
  assert.ok(writer.saves[0].markdown.endsWith("![](f24.png)"));
  assert.ok(writer.saves[1].markdown.startsWith("![](/assets/id00)"));
  assert.ok(writer.saves[1].markdown.endsWith("![](attachment://id24)"));
  assert.deepEqual([...new Set(writer.saves.flatMap((save) => save.types))], ["image/png"]);
});

test("그림이 아니거나 10MB를 넘는 파일은 넣지 않고, 같은 그림은 한 번만 보낸다", async () => {
  const big = { path: "big.png", size: 10 * 1024 * 1024 + 1, read: async () => PNG };
  const fig = bundleFile("fig.png", PNG);
  const markdown = "![](fig.png) ![](./fig.png) ![](fake.png) ![](big.png)";
  const document = {
    file: bundleFile("note.md", markdown),
    markdown,
    images: [{ ref: "fig.png", file: fig }, { ref: "fake.png", file: bundleFile("fake.png", "not an image") }, { ref: "big.png", file: big }],
    missing: []
  };
  const writer = fakeWriter();

  const result = await uploadMarkdownBundleDocument(document, writer, numberedIds());

  assert.deepEqual(result.rejected, ["fake.png", "big.png"]);
  assert.equal(writer.saves.length, 1);
  assert.equal(writer.saves[0].markdown, "![](attachment://id00) ![](attachment://id00) ![](fake.png) ![](big.png)");
});

test("저장이 실패하면 멈추고 남은 그림 수와 오류를 돌려준다(문서는 남는다)", async () => {
  const names = Array.from({ length: 22 }, (_, index) => `f${index}.png`);
  const markdown = names.map((name) => `![](${name})`).join(" ");
  const document = { file: bundleFile("n.md", markdown), markdown, images: names.map((name) => ({ ref: name, file: bundleFile(name, PNG) })), missing: [] };
  const writer = fakeWriter({ failOnSave: 1 });

  const result = await uploadMarkdownBundleDocument(document, writer, numberedIds());

  assert.equal(result.attached, 20);
  assert.equal(result.failed.count, 2);
  assert.equal(result.failed.error.code, "STORAGE_QUOTA_EXCEEDED");
});
