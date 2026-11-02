import assert from "node:assert/strict";
import test from "node:test";

const { imageBlockAttrsFromMarkdown, inlineImageAttrsFromMarkdown } = await import("../src/features/note-editing/model/imageAltText.ts");

// remark는 제목 없는 `![alt](src)`의 title을 null로 준다. 편집기 스키마는 문자열만 받아 RangeError로 문서를 열지 못했다.
test("제목 없는 이미지 블록은 caption을 빈 문자열로 만든다", () => {
  assert.deepEqual(imageBlockAttrsFromMarkdown({ url: "/api/workspaces/ws_1/assets/a/content", alt: "사진", title: null }), {
    src: "/api/workspaces/ws_1/assets/a/content", caption: "", ratio: 1, alt: "사진"
  });
  assert.deepEqual(imageBlockAttrsFromMarkdown({ url: "x.png", alt: "0.50", title: "설명" }), { src: "x.png", caption: "설명", ratio: 0.5, alt: "" });
  assert.deepEqual(imageBlockAttrsFromMarkdown({ url: undefined, alt: null, title: undefined }), { src: "", caption: "", ratio: 1, alt: "" });
});

test("제목 없는 인라인 이미지는 title·alt를 빈 문자열로 만든다", () => {
  assert.deepEqual(inlineImageAttrsFromMarkdown({ url: "x.png", alt: "a", title: null }), { src: "x.png", alt: "a", title: "" });
  assert.deepEqual(inlineImageAttrsFromMarkdown({ url: "x.png", alt: null, title: "t" }), { src: "x.png", alt: "", title: "t" });
});
