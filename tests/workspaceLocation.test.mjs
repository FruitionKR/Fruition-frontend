import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspaceHref,
  formatWorkspaceDocumentTitle,
  getWorkspaceLocationKey,
  getWorkspaceLocationView,
  isDocumentLocation,
  parseWorkspaceLocation,
  toDocumentLocation
} from "../src/widgets/workspace/lib/workspaceLocation.ts";

const params = (query) => new URLSearchParams(query);

test("파라미터가 없으면 홈(첫 노트 열기) 위치다", () => {
  assert.deepEqual(parseWorkspaceLocation(params("")), { kind: "home" });
  assert.deepEqual(parseWorkspaceLocation(null), { kind: "home" });
});

test("문서·트리 항목·위키 페이지·화면 파라미터를 읽는다", () => {
  assert.deepEqual(parseWorkspaceLocation(params("doc=d1")), { kind: "document", documentId: "d1" });
  assert.deepEqual(parseWorkspaceLocation(params("tree=t1")), { kind: "tree", treeItemId: "t1" });
  assert.deepEqual(parseWorkspaceLocation(params("page=p1")), { kind: "page", pageId: "p1" });
  assert.deepEqual(parseWorkspaceLocation(params("view=graph")), { kind: "view", view: "graph" });
  assert.deepEqual(parseWorkspaceLocation(params("view=logs")), { kind: "view", view: "logs" });
  assert.deepEqual(parseWorkspaceLocation(params("view=skills")), { kind: "view", view: "skills" });
  assert.deepEqual(parseWorkspaceLocation(params("view=settings")), { kind: "view", view: "settings" });
  assert.deepEqual(parseWorkspaceLocation(params("view=notifications")), { kind: "view", view: "notifications" });
});

test("여러 파라미터가 있으면 화면 → 위키 페이지 → 문서 → 트리 항목 순으로 고른다", () => {
  assert.deepEqual(parseWorkspaceLocation(params("doc=d1&view=graph")), { kind: "view", view: "graph" });
  assert.deepEqual(parseWorkspaceLocation(params("tree=t1&doc=d1&page=p1")), { kind: "page", pageId: "p1" });
  assert.deepEqual(parseWorkspaceLocation(params("tree=t1&doc=d1")), { kind: "document", documentId: "d1" });
});

test("알 수 없는 화면·빈 값은 무시한다", () => {
  assert.deepEqual(parseWorkspaceLocation(params("view=unknown")), { kind: "home" });
  assert.deepEqual(parseWorkspaceLocation(params("view=home&doc=d1")), { kind: "document", documentId: "d1" });
  assert.deepEqual(parseWorkspaceLocation(params("doc=&tree=t1")), { kind: "tree", treeItemId: "t1" });
  assert.deepEqual(parseWorkspaceLocation(params("doc=%20%20")), { kind: "home" });
});

test("위치를 /home URL로 만든다", () => {
  assert.equal(buildWorkspaceHref({ kind: "home" }), "/home");
  assert.equal(buildWorkspaceHref({ kind: "document", documentId: "d1" }), "/home?doc=d1");
  assert.equal(buildWorkspaceHref({ kind: "tree", treeItemId: "t1" }), "/home?tree=t1");
  assert.equal(buildWorkspaceHref({ kind: "page", pageId: "p1" }), "/home?page=p1");
  assert.equal(buildWorkspaceHref({ kind: "view", view: "graph" }), "/home?view=graph");
  assert.equal(buildWorkspaceHref({ kind: "view", view: "notifications" }), "/home?view=notifications");
});

test("id의 특수 문자는 인코딩하고 다시 읽으면 같은 위치가 된다", () => {
  const location = { kind: "page", pageId: "wiki:concept/a b&c=d" };
  const href = buildWorkspaceHref(location);
  assert.equal(href, "/home?page=wiki%3Aconcept%2Fa+b%26c%3Dd");
  assert.deepEqual(parseWorkspaceLocation(new URL(href, "http://localhost").searchParams), location);
});

test("위치 키는 같은 대상끼리 같고 종류가 다르면 다르다", () => {
  assert.equal(getWorkspaceLocationKey({ kind: "home" }), "home");
  assert.equal(getWorkspaceLocationKey({ kind: "document", documentId: "x" }), "document:x");
  assert.equal(getWorkspaceLocationKey({ kind: "tree", treeItemId: "x" }), "tree:x");
  assert.equal(getWorkspaceLocationKey({ kind: "page", pageId: "x" }), "page:x");
  assert.equal(getWorkspaceLocationKey({ kind: "view", view: "graph" }), "view:graph");
});

test("선택 대상은 위키 페이지 → 문서 → 트리 항목 순으로 위치가 된다", () => {
  assert.deepEqual(toDocumentLocation({ pageId: "p1", documentId: "d1", treeItemId: "t1" }), { kind: "page", pageId: "p1" });
  assert.deepEqual(toDocumentLocation({ pageId: null, documentId: "d1", treeItemId: "t1" }), { kind: "document", documentId: "d1" });
  assert.deepEqual(toDocumentLocation({ pageId: null, documentId: null, treeItemId: "t1" }), { kind: "tree", treeItemId: "t1" });
  assert.equal(toDocumentLocation({ pageId: null, documentId: null, treeItemId: null }), null);
});

test("위치에서 화면(홈/그래프/로그…)을 정한다", () => {
  assert.equal(getWorkspaceLocationView({ kind: "home" }), "home");
  assert.equal(getWorkspaceLocationView({ kind: "document", documentId: "d1" }), "home");
  assert.equal(getWorkspaceLocationView({ kind: "page", pageId: "p1" }), "home");
  assert.equal(getWorkspaceLocationView({ kind: "view", view: "graph" }), "graph");
  assert.equal(getWorkspaceLocationView({ kind: "view", view: "logs" }), "logs");
  assert.equal(getWorkspaceLocationView({ kind: "view", view: "notifications" }), "notifications");
});

test("문서를 가리키는 위치인지 구분한다", () => {
  assert.equal(isDocumentLocation({ kind: "document", documentId: "d1" }), true);
  assert.equal(isDocumentLocation({ kind: "tree", treeItemId: "t1" }), true);
  assert.equal(isDocumentLocation({ kind: "page", pageId: "p1" }), true);
  assert.equal(isDocumentLocation({ kind: "home" }), false);
  assert.equal(isDocumentLocation({ kind: "view", view: "graph" }), false);
});

test("브라우저 탭 제목은 화면 제목 뒤에 서비스 이름을 붙인다", () => {
  assert.equal(formatWorkspaceDocumentTitle("회의록"), "회의록 - Fruition Agent");
  assert.equal(formatWorkspaceDocumentTitle("그래프"), "그래프 - Fruition Agent");
  assert.equal(formatWorkspaceDocumentTitle(null), "Fruition Agent");
  assert.equal(formatWorkspaceDocumentTitle("  "), "Fruition Agent");
});
