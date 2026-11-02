import assert from "node:assert/strict";
import test from "node:test";

const { internalAppHref, shouldOpenInApp } = await import("../src/features/note-editing/model/internalAppLinks.ts");

const ORIGIN = "https://app.fruition.example";

test("앱 문서·위키 주소만 앱 안에서 열 주소로 본다", () => {
  assert.equal(internalAppHref("/home?doc=doc_1", ORIGIN), "/home?doc=doc_1");
  assert.equal(internalAppHref("/home?page=wp_1#h", ORIGIN), "/home?page=wp_1#h");
  assert.equal(internalAppHref(`${ORIGIN}/home?doc=doc_2`, ORIGIN), "/home?doc=doc_2");
  // 외부·다른 경로·스킴 우회는 앱 링크가 아니다.
  assert.equal(internalAppHref("https://example.com/home?doc=1", ORIGIN), null);
  assert.equal(internalAppHref("//evil.example/home?doc=1", ORIGIN), null);
  assert.equal(internalAppHref("/\\evil.example/home", ORIGIN), null);
  assert.equal(internalAppHref("javascript:alert(1)", ORIGIN), null);
  assert.equal(internalAppHref("/api/workspaces/ws/assets/a/content", ORIGIN), null);
  assert.equal(internalAppHref("/settings", ORIGIN), null);
  assert.equal(internalAppHref("", ORIGIN), null);
  assert.equal(internalAppHref(null, ORIGIN), null);
});

test("Cmd/Ctrl+클릭(가운데·Shift 제외)만 편집기 안 링크를 앱 안에서 연다", () => {
  const click = (overrides) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides });
  assert.equal(shouldOpenInApp(click({ metaKey: true })), true);
  assert.equal(shouldOpenInApp(click({ ctrlKey: true })), true);
  assert.equal(shouldOpenInApp(click({})), false, "그냥 클릭은 편집(캐럿 이동)이다");
  assert.equal(shouldOpenInApp(click({ metaKey: true, shiftKey: true })), false);
  assert.equal(shouldOpenInApp(click({ metaKey: true, button: 1 })), false);
});
