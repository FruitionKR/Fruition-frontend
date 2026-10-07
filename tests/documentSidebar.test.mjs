import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canCreateProjectFromView, getBlankAreaContextProjectId } from "../src/widgets/document-sidebar/model/sidebarMenu.ts";

const sidebarMenuRowPath = new URL(
  "../src/widgets/document-sidebar/ui/SidebarMenuRow.tsx",
  import.meta.url
);
const contextMenuPath = new URL(
  "../src/widgets/document-sidebar/ui/ContextMenu.tsx",
  import.meta.url
);
const documentSidebarPath = new URL(
  "../src/widgets/document-sidebar/ui/DocumentSidebar.tsx",
  import.meta.url
);

test("새 폴더 생성은 홈 뷰에서만 허용한다", () => {
  assert.equal(canCreateProjectFromView("home"), true);

  for (const view of ["graph", "logs", "rules", "settings"]) {
    assert.equal(canCreateProjectFromView(view), false);
  }
});

test("메뉴 행에는 파일 업로드·새 폴더 버튼을 두지 않는다", async () => {
  const source = await readFile(sidebarMenuRowPath, "utf8");

  // 생성은 우클릭 메뉴·폴더 hover + 버튼·드롭 업로드로만 제공한다.
  assert.doesNotMatch(source, /aria-label="파일 업로드"/);
  assert.doesNotMatch(source, /aria-label="새 폴더 생성"/);
  assert.doesNotMatch(source, /onAddProject|onUploadFile/);
});

test("컨텍스트 메뉴의 새 폴더도 같은 생성 정책을 따른다", async () => {
  const [menuSource, sidebarSource] = await Promise.all([
    readFile(contextMenuPath, "utf8"),
    readFile(documentSidebarPath, "utf8")
  ]);

  assert.match(menuSource, /canCreateProject\s*&&\s*\(\s*<button[^>]*>새 폴더<\/button>/);
  assert.match(sidebarSource, /canCreateProject=\{canCreateProjectFromView\(activeView\)\}/);
});

test("빈 영역 우클릭은 문서 뷰에서만 첫 프로젝트 메뉴를 연다", () => {
  const projects = [{ id: "p1" }, { id: "p2" }];

  assert.equal(getBlankAreaContextProjectId("home", false, projects), "p1");

  // graph/logs 뷰에서는 열지 않는다.
  for (const view of ["graph", "logs"]) {
    assert.equal(getBlankAreaContextProjectId(view, false, projects), null);
  }
  // 트리 항목에서 이미 연 메뉴(defaultPrevented)는 덮어쓰지 않는다.
  assert.equal(getBlankAreaContextProjectId("home", true, projects), null);
  // 프로젝트가 없으면 무시한다.
  assert.equal(getBlankAreaContextProjectId("home", false, []), null);
});

test("사이드바 빈 영역 핸들러는 getBlankAreaContextProjectId 정책을 따른다", async () => {
  const source = await readFile(documentSidebarPath, "utf8");

  assert.match(
    source,
    /getBlankAreaContextProjectId\(activeView,\s*event\.defaultPrevented,\s*projects\)/
  );
});

test("열린 컨텍스트 메뉴 위 우클릭은 빈 영역 핸들러가 메뉴를 덮어쓰지 않는다", async () => {
  const source = await readFile(contextMenuPath, "utf8");

  // 메뉴가 preventDefault하면 빈 영역 핸들러의 defaultPrevented 가드에 걸린다.
  assert.match(source, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
});

test("문서 컨텍스트 메뉴는 사이드바 스태킹 컨텍스트를 벗어나 body에 렌더한다", async () => {
  const source = await readFile(contextMenuPath, "utf8");

  // createPortal(<JSX>, document.body) 형태로 실제 포탈 대상이 body인지까지 검증한다.
  assert.match(source, /return createPortal\(/);
  assert.match(source, /,\s*document\.body\s*\)/);
});
