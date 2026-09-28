import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { extractAttachmentIds, validateImageFile, substituteAttachmentPaths, ATTACHMENT_SCHEME } =
  await import("../src/features/note-editing/model/imageAttachments.ts");
const { isManagedAssetPath } = await import("../src/shared/api/assets.ts");

const A = "0c973836-6687-4018-b2c7-f2f66984e87b";
const B = "dc8f9e82-3397-4f18-9f42-dd9998796e2f";

test("본문에서 attachment placeholder id를 등장 순·중복 없이 뽑는다", () => {
  const markdown = `![](${ATTACHMENT_SCHEME}${A})\n\n텍스트 ![x](${ATTACHMENT_SCHEME}${B.toUpperCase()}) ![](${ATTACHMENT_SCHEME}${A})`;
  assert.deepEqual(extractAttachmentIds(markdown), [A, B]);
  assert.deepEqual(extractAttachmentIds("![](blob:http://x/abc) ![](data:image/png;base64,AAAA)"), []);
});

test("서버 매핑으로 placeholder만 관리 경로로 치환하고 나머지는 그대로 둔다", () => {
  const markdown = `![a](${ATTACHMENT_SCHEME}${A}) ![b](${ATTACHMENT_SCHEME}${B}) 뒤 글자`;
  const saved = new Map([[A, "/api/workspaces/ws/assets/asset_1/content"]]);
  assert.equal(
    substituteAttachmentPaths(markdown, saved),
    `![a](/api/workspaces/ws/assets/asset_1/content) ![b](${ATTACHMENT_SCHEME}${B}) 뒤 글자`
  );
  assert.equal(substituteAttachmentPaths(markdown, new Map()), markdown);
});

test("이미지 형식·크기는 백엔드 제한과 같은 기준으로 먼저 거른다", () => {
  assert.equal(validateImageFile({ type: "image/png", size: 10 }), null);
  assert.equal(validateImageFile({ type: "image/webp", size: 10 * 1024 * 1024 }), null);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 10 }), /PNG, JPEG, WebP, GIF/);
  assert.match(validateImageFile({ type: "image/png", size: 0 }), /빈 이미지/);
  assert.match(validateImageFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }), /10MB/);
});

test("관리 이미지 경로만 인증 fetch 대상으로 본다", () => {
  assert.equal(isManagedAssetPath("/api/workspaces/ws_1/assets/asset_1/content"), true);
  assert.equal(isManagedAssetPath("https://example.com/a.png"), false);
  assert.equal(isManagedAssetPath("data:image/png;base64,AAAA"), false);
  assert.equal(isManagedAssetPath("/api/workspaces/ws_1/documents/doc_1/original"), false);
});

test("붙여넣기 묶음에서 이미지가 아닌 파일은 무시하고 넣을 수 없는 이미지만 걸러낸다", async () => {
  const { partitionImageFiles } = await import("../src/features/note-editing/model/imageAttachments.ts");
  const file = (name, type, size) => ({ name, type, size });
  const result = partitionImageFiles([
    file("ok.png", "image/png", 10),
    file("vector.svg", "image/svg+xml", 10),
    file("huge.jpg", "image/jpeg", 10 * 1024 * 1024 + 1),
    file("notes.txt", "text/plain", 10)
  ]);
  assert.deepEqual(result.accepted.map((f) => f.name), ["ok.png"]);
  assert.deepEqual(result.rejected.map((r) => r.file.name), ["vector.svg", "huge.jpg"]);
  assert.match(result.rejected[1].reason, /10MB/);
});

test("본문에서 관리 이미지 경로만 중복 없이 뽑는다", async () => {
  const { extractManagedAssetPaths } = await import("../src/shared/api/assets.ts");
  const markdown = "![a](/api/workspaces/ws_1/assets/asset_1/content) 글 ![b](/api/workspaces/ws_1/assets/asset_2/content)\n![a](/api/workspaces/ws_1/assets/asset_1/content) ![x](https://x.io/a.png) ![d](data:image/png;base64,AAAA)";
  assert.deepEqual(extractManagedAssetPaths(markdown), [
    "/api/workspaces/ws_1/assets/asset_1/content",
    "/api/workspaces/ws_1/assets/asset_2/content"
  ]);
  assert.deepEqual(extractManagedAssetPaths("이미지 없음"), []);
});

test("이미지 alt는 Crepe 비율 형식(소수점 둘째 자리)일 때만 비율로 보고 나머지는 보존한다", async () => {
  const { splitImageAlt, formatImageAlt } = await import("../src/features/note-editing/model/imageAltText.ts");
  assert.deepEqual(splitImageAlt("1.00"), { alt: "", ratio: 1 });
  assert.deepEqual(splitImageAlt("0.75"), { alt: "", ratio: 0.75 });
  assert.deepEqual(splitImageAlt("2024"), { alt: "2024", ratio: 1 });
  assert.deepEqual(splitImageAlt("diagram"), { alt: "diagram", ratio: 1 });
  assert.deepEqual(splitImageAlt(""), { alt: "", ratio: 1 });
  assert.deepEqual(splitImageAlt(undefined), { alt: "", ratio: 1 });
  assert.deepEqual(splitImageAlt("0.00"), { alt: "0.00", ratio: 1 });
  assert.equal(formatImageAlt("diagram", 0.5), "diagram");
  assert.equal(formatImageAlt("", 0.5), "0.50");
  assert.equal(formatImageAlt("2024", 1), "2024");
});
