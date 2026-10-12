import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";

/** /home URL의 view 파라미터로 여는 화면. 홈(문서) 화면은 view 없이 문서 파라미터로 나타낸다. */
export type WorkspaceView = Exclude<RailView, "home">;

/**
 * /home URL이 가리키는 화면. 워크스페이스 화면 상태(문서 선택·화면 전환)의 단일 기준이다.
 * - home: 파라미터 없음. 첫 노트를 연다.
 * - page/document/tree: 위키 페이지(source/concept)·문서·문서 id가 없는 트리 항목을 홈 화면에서 연다.
 * - view: 그래프·로그·규칙·알림·설정 화면
 */
export type WorkspaceLocation =
  | { kind: "home" }
  | { kind: "page"; pageId: string }
  | { kind: "document"; documentId: string }
  | { kind: "tree"; treeItemId: string }
  | { kind: "view"; view: WorkspaceView };

export const WORKSPACE_HOME_LOCATION: WorkspaceLocation = { kind: "home" };

const WORKSPACE_PATH = "/home";
const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["graph", "skills", "logs", "notifications", "settings"];
const APP_TITLE = "Fruition Agent";

type SearchParamsLike = { get: (name: string) => string | null };

function readParam(params: SearchParamsLike, name: string): string | null {
  const value = params.get(name);
  return value && value.trim() ? value : null;
}

function isWorkspaceView(value: string): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(value);
}

/** URL 검색 파라미터를 화면 위치로 읽는다. 여러 개면 화면 → 위키 페이지 → 문서 → 트리 항목 순으로 고른다. */
export function parseWorkspaceLocation(params: SearchParamsLike | null): WorkspaceLocation {
  if (!params) return WORKSPACE_HOME_LOCATION;
  const view = readParam(params, "view");
  if (view && isWorkspaceView(view)) return { kind: "view", view };
  const pageId = readParam(params, "page");
  if (pageId) return { kind: "page", pageId };
  const documentId = readParam(params, "doc");
  if (documentId) return { kind: "document", documentId };
  const treeItemId = readParam(params, "tree");
  if (treeItemId) return { kind: "tree", treeItemId };
  return WORKSPACE_HOME_LOCATION;
}

function toSearchParam(location: WorkspaceLocation): [name: string, value: string] | null {
  switch (location.kind) {
    case "home": return null;
    case "page": return ["page", location.pageId];
    case "document": return ["doc", location.documentId];
    case "tree": return ["tree", location.treeItemId];
    case "view": return ["view", location.view];
  }
}

export function buildWorkspaceHref(location: WorkspaceLocation): string {
  const param = toSearchParam(location);
  if (!param) return WORKSPACE_PATH;
  return `${WORKSPACE_PATH}?${new URLSearchParams([param]).toString()}`;
}

/** 같은 대상인지 비교하는 키. 선택 상태와 URL이 이미 맞는지 볼 때 쓴다. */
export function getWorkspaceLocationKey(location: WorkspaceLocation): string {
  const param = toSearchParam(location);
  if (!param) return location.kind;
  return `${location.kind}:${param[1]}`;
}

/** 선택한 대상의 위치. 위키 페이지 → 문서 → 트리 항목 순으로 정하고, 대상이 없으면 null. */
export function toDocumentLocation(target: {
  pageId: string | null;
  documentId: string | null;
  treeItemId: string | null;
}): WorkspaceLocation | null {
  if (target.pageId) return { kind: "page", pageId: target.pageId };
  if (target.documentId) return { kind: "document", documentId: target.documentId };
  if (target.treeItemId) return { kind: "tree", treeItemId: target.treeItemId };
  return null;
}

export function isDocumentLocation(location: WorkspaceLocation): boolean {
  return location.kind === "page" || location.kind === "document" || location.kind === "tree";
}

/** 위치가 여는 화면. view가 없으면 문서를 여는 홈 화면이다. */
export function getWorkspaceLocationView(location: WorkspaceLocation): RailView {
  return location.kind === "view" ? location.view : "home";
}

/** 브라우저 탭 제목. 앱 metadata 제목(Fruition Agent)을 뒤에 붙인다. */
export function formatWorkspaceDocumentTitle(screenTitle: string | null): string {
  const title = screenTitle?.trim();
  return title ? `${title} - ${APP_TITLE}` : APP_TITLE;
}
