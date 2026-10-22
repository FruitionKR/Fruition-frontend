import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";

/** 설정 화면의 항목. 레일 톱니는 디스플레이, 프로필은 사용자 설정으로 연다. */
export type SettingsSection = "profile" | "account" | "notifications" | "preferences" | "general" | "members" | "documents";
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["profile", "account", "notifications", "preferences", "general", "members", "documents"];
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

/** /home URL의 view 파라미터로 여는 화면. 홈(문서) 화면은 view 없이 문서 파라미터로 나타낸다. */
export type WorkspaceView = Exclude<RailView, "home">;

/**
 * /home URL이 가리키는 화면. 워크스페이스 화면 상태(문서 선택·화면 전환)의 단일 기준이다.
 * - home: 파라미터 없음. 첫 노트를 연다.
 * - page/document/tree: 위키 페이지(source/concept)·문서·문서 id가 없는 트리 항목을 홈 화면에서 연다.
 * - view: 그래프·로그·규칙·알림·설정 화면. 설정은 section으로 열 항목을 가리킨다(없으면 사용자 설정).
 */
export type WorkspaceLocation =
  | { kind: "home" }
  | { kind: "page"; pageId: string }
  | { kind: "document"; documentId: string }
  | { kind: "tree"; treeItemId: string }
  | { kind: "view"; view: WorkspaceView; section?: SettingsSection };

export const WORKSPACE_HOME_LOCATION: WorkspaceLocation = { kind: "home" };

const WORKSPACE_PATH = "/home";
const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["graph", "skills", "logs", "notifications", "settings"];
const APP_TITLE = "Fruition";

type SearchParamsLike = { get: (name: string) => string | null };

function readParam(params: SearchParamsLike, name: string): string | null {
  const value = params.get(name);
  return value && value.trim() ? value : null;
}

function isWorkspaceView(value: string): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(value);
}

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** URL 검색 파라미터를 화면 위치로 읽는다. 여러 개면 화면 → 위키 페이지 → 문서 → 트리 항목 순으로 고른다. */
export function parseWorkspaceLocation(params: SearchParamsLike | null): WorkspaceLocation {
  if (!params) return WORKSPACE_HOME_LOCATION;
  const view = readParam(params, "view");
  if (view && isWorkspaceView(view)) {
    const section = view === "settings" ? readParam(params, "section") : null;
    return section && isSettingsSection(section) ? { kind: "view", view, section } : { kind: "view", view };
  }
  const pageId = readParam(params, "page");
  if (pageId) return { kind: "page", pageId };
  const documentId = readParam(params, "doc");
  if (documentId) return { kind: "document", documentId };
  const treeItemId = readParam(params, "tree");
  if (treeItemId) return { kind: "tree", treeItemId };
  return WORKSPACE_HOME_LOCATION;
}

function toSearchParams(location: WorkspaceLocation): [name: string, value: string][] {
  switch (location.kind) {
    case "home": return [];
    case "page": return [["page", location.pageId]];
    case "document": return [["doc", location.documentId]];
    case "tree": return [["tree", location.treeItemId]];
    case "view": return location.section ? [["view", location.view], ["section", location.section]] : [["view", location.view]];
  }
}

export function buildWorkspaceHref(location: WorkspaceLocation): string {
  const params = toSearchParams(location);
  if (params.length === 0) return WORKSPACE_PATH;
  return `${WORKSPACE_PATH}?${new URLSearchParams(params).toString()}`;
}

/**
 * 워크스페이스를 바꿀 때 갈 주소. 문서·위키 페이지·트리 항목(doc·page·tree)은 이전 워크스페이스 것이라 버리고,
 * 그래프·스킬·설정 같은 화면 선택만 남긴다. 새 워크스페이스에서 "문서를 찾을 수 없습니다"가 뜨지 않게 한다.
 */
export function workspaceSwitchHref(params: SearchParamsLike | null): string {
  const location = parseWorkspaceLocation(params);
  return buildWorkspaceHref(location.kind === "view" ? location : WORKSPACE_HOME_LOCATION);
}

/** 같은 대상인지 비교하는 키. 선택 상태와 URL이 이미 맞는지 볼 때 쓴다. */
export function getWorkspaceLocationKey(location: WorkspaceLocation): string {
  const params = toSearchParams(location);
  if (params.length === 0) return location.kind;
  return `${location.kind}:${params.map(([, value]) => value).join(":")}`;
}

/** 설정 화면에서 연 항목. 설정 화면이 아니거나 section이 없으면 기본 항목이다. */
export function getSettingsSection(location: WorkspaceLocation): SettingsSection {
  return location.kind === "view" && location.view === "settings" && location.section ? location.section : DEFAULT_SETTINGS_SECTION;
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

/** 문서와 화면을 바꿔도 브라우저 탭은 서비스 이름으로 고정한다. */
export function formatWorkspaceDocumentTitle(_screenTitle: string | null): string {
  return APP_TITLE;
}
