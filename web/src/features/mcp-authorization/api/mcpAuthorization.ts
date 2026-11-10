import { fetchMe } from "@/entities/user/api/account";
import { apiFetch } from "@/shared/api/client";
import { getAccessToken, getAccessTokenVersion } from "@/shared/lib/authSessionStorage";

const AUTHORIZATION_PATH = "/mcp/authorize";
const MAX_RESUME_PATH_BYTES = 4096;
const AUTHORIZATION_PARAMETERS = new Set([
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource"
]);
const MCP_SCOPES = new Set(["read", "write_propose", "wiki_write"] as const);

export type McpScope = "read" | "write_propose" | "wiki_write";

export type McpWorkspaceChoice = {
  workspace_id: string;
  workspace_name: string;
  role: "OWNER" | "MEMBER";
  policy_generation: number;
  /** 이 워크스페이스를 고르면 실제로 부여될 범위(요청 범위 ∩ 워크스페이스 MCP 정책). */
  scopes: McpScope[];
};

export type McpPendingAuthorization = {
  pending_id: string;
  client_id: string;
  client_name: string | null;
  redirect_host: string;
  app_identity_verified: false;
  scopes: McpScope[];
  workspaces: McpWorkspaceChoice[];
  expires_at: string;
};

export type McpAuthorizationSession = {
  pending: McpPendingAuthorization;
  csrfToken: string;
  accessToken: string;
  accessTokenVersion: number;
  decisionStarted: boolean;
};

export type McpAuthorizationErrorCode =
  | "INVALID_QUERY"
  | "INVALID_PREVIEW"
  | "PREVIEW_FAILED"
  | "EXPIRED"
  | "INVALID_WORKSPACE"
  | "AUTH_CHANGED"
  | "DECISION_STARTED"
  | "DECISION_FAILED"
  | "UNSAFE_REDIRECT";

export class McpAuthorizationError extends Error {
  readonly code: McpAuthorizationErrorCode;

  constructor(code: McpAuthorizationErrorCode) {
    super(code);
    this.code = code;
  }
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    throw new McpAuthorizationError("INVALID_QUERY");
  }
}

/** Access가 handoff한 OAuth query를 바꾸지 않고 로그인 resume에 쓸 수 있는지 확인한다. */
export function authorizationResumePath(rawSearch: string): string {
  if (!rawSearch.startsWith("?") || rawSearch.length === 1) {
    throw new McpAuthorizationError("INVALID_QUERY");
  }
  const rawQuery = rawSearch.slice(1);
  if (new TextEncoder().encode(`${AUTHORIZATION_PATH}${rawSearch}`).byteLength > MAX_RESUME_PATH_BYTES) {
    throw new McpAuthorizationError("INVALID_QUERY");
  }

  const seen = new Set<string>();
  for (const field of rawQuery.split("&")) {
    const separator = field.indexOf("=");
    if (separator <= 0) throw new McpAuthorizationError("INVALID_QUERY");
    const rawName = field.slice(0, separator);
    const name = decodeQueryValue(rawName);
    decodeQueryValue(field.slice(separator + 1));
    if (rawName !== name || !AUTHORIZATION_PARAMETERS.has(name) || seen.has(name)) {
      throw new McpAuthorizationError("INVALID_QUERY");
    }
    seen.add(name);
  }
  return `${AUTHORIZATION_PATH}${rawSearch}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseScopes(value: unknown): McpScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes = value.filter((scope): scope is McpScope => typeof scope === "string" && MCP_SCOPES.has(scope as McpScope));
  if (scopes.length !== value.length || new Set(scopes).size !== scopes.length) return null;
  return scopes;
}

function parseWorkspace(value: unknown, requestedScopes: McpScope[]): McpWorkspaceChoice | null {
  if (!isRecord(value)
    || !nonEmptyString(value.workspace_id)
    || !nonEmptyString(value.workspace_name)
    || (value.role !== "OWNER" && value.role !== "MEMBER")
    || !Number.isSafeInteger(value.policy_generation)
    || Number(value.policy_generation) < 1) return null;
  // 배포 전환 중 scopes를 주지 않는 이전 Access 응답은 요청 범위 전체를 부여하던 기존 계약으로 해석한다.
  const scopes = value.scopes === undefined ? requestedScopes : parseScopes(value.scopes);
  if (!scopes
    || (value.scopes !== undefined && scopes.length === 0)
    || scopes.some((scope) => !requestedScopes.includes(scope))) return null;
  return {
    workspace_id: value.workspace_id,
    workspace_name: value.workspace_name,
    role: value.role,
    policy_generation: Number(value.policy_generation),
    scopes
  };
}

export function parsePendingAuthorization(value: unknown): McpPendingAuthorization {
  if (!isRecord(value)
    || !nonEmptyString(value.pending_id)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.pending_id)
    || !nonEmptyString(value.client_id)
    || !(value.client_name === null || value.client_name === undefined || typeof value.client_name === "string")
    || !nonEmptyString(value.redirect_host)
    || value.app_identity_verified !== false
    || !Array.isArray(value.scopes)
    || !Array.isArray(value.workspaces)
    || !nonEmptyString(value.expires_at)) throw new McpAuthorizationError("INVALID_PREVIEW");

  const scopes = parseScopes(value.scopes);
  if (!scopes) throw new McpAuthorizationError("INVALID_PREVIEW");
  const workspaces = value.workspaces.map((workspace) => parseWorkspace(workspace, scopes));
  if (workspaces.some((workspace) => workspace === null)
    || new Set(workspaces.map((workspace) => workspace?.workspace_id)).size !== workspaces.length
    || !Number.isFinite(Date.parse(value.expires_at))) throw new McpAuthorizationError("INVALID_PREVIEW");

  return {
    pending_id: value.pending_id,
    client_id: value.client_id,
    client_name: typeof value.client_name === "string" && value.client_name.trim() ? value.client_name : null,
    redirect_host: value.redirect_host,
    app_identity_verified: false,
    scopes,
    workspaces: workspaces as McpWorkspaceChoice[],
    expires_at: value.expires_at
  };
}

export function isPendingExpired(pending: Pick<McpPendingAuthorization, "expires_at">, now = Date.now()): boolean {
  return Date.parse(pending.expires_at) <= now;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function safeOAuthRedirect(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim()) throw new McpAuthorizationError("UNSAFE_REDIRECT");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpAuthorizationError("UNSAFE_REDIRECT");
  }
  const safeProtocol = url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  if (!safeProtocol || url.username || url.password) throw new McpAuthorizationError("UNSAFE_REDIRECT");
  return value;
}

export async function previewMcpAuthorization(rawSearch: string): Promise<McpAuthorizationSession> {
  const path = authorizationResumePath(rawSearch).replace(AUTHORIZATION_PATH, "/oauth2/authorize");
  // Cookie 인증만으로 성공하는 authorize 요청 전에 메모리 Bearer 세션을 복원한다.
  if (!getAccessToken()) await fetchMe();
  const response = await apiFetch(path, {
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new McpAuthorizationError("PREVIEW_FAILED");
  const csrfToken = response.headers.get("X-CSRF-TOKEN");
  const accessToken = getAccessToken();
  if (!csrfToken || !accessToken) throw new McpAuthorizationError("INVALID_PREVIEW");
  const pending = parsePendingAuthorization(await response.json().catch(() => null));
  if (isPendingExpired(pending)) throw new McpAuthorizationError("EXPIRED");
  return {
    pending,
    csrfToken,
    accessToken,
    accessTokenVersion: getAccessTokenVersion(),
    decisionStarted: false
  };
}

export async function decideMcpAuthorization(
  session: McpAuthorizationSession,
  decision: "APPROVE" | "DENY",
  workspaceId?: string
): Promise<string> {
  if (session.decisionStarted) throw new McpAuthorizationError("DECISION_STARTED");
  if (isPendingExpired(session.pending)) throw new McpAuthorizationError("EXPIRED");
  if (decision === "APPROVE" && (!workspaceId || !session.pending.workspaces.some((workspace) => workspace.workspace_id === workspaceId))) {
    throw new McpAuthorizationError("INVALID_WORKSPACE");
  }
  if (getAccessToken() !== session.accessToken || getAccessTokenVersion() !== session.accessTokenVersion) {
    throw new McpAuthorizationError("AUTH_CHANGED");
  }

  session.decisionStarted = true;
  const response = await fetch(`/oauth2/authorize/${encodeURIComponent(session.pending.pending_id)}`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": session.csrfToken
    },
    body: JSON.stringify(decision === "APPROVE"
      ? { decision, workspace_id: workspaceId }
      : { decision })
  });
  if (!response.ok) throw new McpAuthorizationError("DECISION_FAILED");
  const body = await response.json().catch(() => null);
  return safeOAuthRedirect(isRecord(body) ? body.redirect_uri : null);
}
