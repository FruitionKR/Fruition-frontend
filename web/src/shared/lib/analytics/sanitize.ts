const eventKeys: Record<string, readonly string[]> = {
  $pageview: ["$current_url", "$pathname", "$screen"],
  citation_opened: ["query_id", "rank", "citation_type", "document_id"],
  ai_edit_decided: ["proposal_id", "document_id", "edit_type", "decision"],
  edit_review_shown: ["proposal_id", "document_id", "edit_type"],
  restore_previewed: ["operation_id", "operation_type"],
  ingest_picker_opened: [],
  chat_export_started: ["export_id", "conversation_id", "mode"],
  upload_failed_shown: ["upload_attempt_id", "reason"],
  graph_opened: [],
  graph_node_previewed: ["node_type"],
  $identify: ["$anon_distinct_id"],
  $groupidentify: ["$group_type", "$group_key"],
};
// token은 SDK 수집 전송에 필요한 공개 프로젝트 키다. URL의 인증 token과 구분한다.
const commonKeys = ["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$groups", "$user_id", "$is_identified", "$process_person_profile", "$lib", "$lib_version", "event_id", "event_source", "environment", "schema_version", "app_version", "workspace_id"];
const screens = new Set(["home", "graph", "logs", "notifications", "settings", "skills", "page", "document", "tree"]);
const routes = new Set(["/", "/home", "/workspaces", "/login", "/signup", "/signup/verify", "/oauth/callback", "/forgot-password", "/reset-password", "/privacy", "/terms"]);

/** 알 수 없는 경로도 원문을 보내지 않는다. 초대 토큰은 경로에 있기 때문이다. */
export function analyticsLocation(raw: string): { $current_url: string; $pathname: string; $screen?: string } {
  const url = new URL(raw, "https://redacted.invalid");
  const path = /^\/invitations\/[^/]+\/?$/.test(url.pathname) ? "/invitations/:token" : routes.has(url.pathname) ? url.pathname : "/:route";
  const view = url.searchParams.get("view") ?? (url.searchParams.has("doc") ? "document" : url.searchParams.has("page") ? "page" : url.searchParams.has("tree") ? "tree" : "home");
  return { $current_url: `${url.origin}${path}`, $pathname: path, ...(path === "/home" && screens.has(view) ? { $screen: view } : {}) };
}

/** SDK가 자동 부착한 referrer·URL·person 속성까지 최종 전송 경계에서 제거한다. */
export function sanitizeAnalyticsEvent<T extends { event: string; properties: Record<string, unknown> }>(event: T): T | null {
  const keys = eventKeys[event.event];
  if (!keys) return null;
  const allowed = new Set([...commonKeys, ...keys]);
  const properties = Object.fromEntries(Object.entries(event.properties).filter(([key]) => allowed.has(key)));
  if (event.event === "$pageview") {
    const screen = properties.$screen;
    delete properties.$screen;
    Object.assign(properties, analyticsLocation(String(properties.$current_url ?? "/")));
    // capturePageview가 URL을 먼저 정리한 경우에도 검증된 화면 분류를 보존한다.
    if (properties.$pathname === "/home" && typeof screen === "string" && screens.has(screen)) properties.$screen = screen;
  }
  const clean = { ...event, properties };
  // SDK는 person 속성을 properties 밖에도 올린다. 초기 방문 URL·referrer가 이 경로로 새지 않게 제거한다.
  for (const key of ["$set", "$set_once", "$unset"]) delete (clean as Record<string, unknown>)[key];
  return clean;
}
