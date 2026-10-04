import { getDocumentTransport, usesDocumentTransport } from "@/shared/api/documentTransport";
import { SessionExpiredError } from "@/shared/lib/errors";
import {
  getAccessToken,
  getSelectedWorkspaceId,
  notifySessionExpired,
  saveAccessToken,
  withAuthRefreshLock
} from "@/shared/lib/auth";

// 공통 에러 메시지 상수
export const ERROR_MESSAGES = {
  loginRequired: "로그인이 필요합니다.",
  loginFailed: "로그인에 실패했습니다.",
  signupFailed: "회원가입에 실패했습니다.",
  workspaceRequired: "워크스페이스를 선택해주세요.",
  workspaceCreateFailed: "워크스페이스 생성에 실패했습니다.",
  uploadFailed: "문서 업로드에 실패했습니다.",
  documentDeleteFailed: "문서 삭제에 실패했습니다.",
  documentRenameFailed: "문서 이름 변경에 실패했습니다.",
  documentConvertFailed: "Markdown 변환 요청에 실패했습니다.",
  editLockHeld: "다른 사용자가 편집 중입니다.",
  editLockLost: "다른 사용자가 편집을 시작해 편집 권한을 잃었습니다. 이후 변경은 저장되지 않습니다.",
  editLockForbidden: "문서 소유자만 편집할 수 있습니다.",
  editLockMissing: "문서를 찾을 수 없습니다.",
  editLockFailed: "편집 잠금을 확인하지 못해 읽기 전용으로 열었습니다.",
  noteDraftLoadFailed: "노트 draft를 불러오지 못했습니다.",
  noteDraftSaveFailed: "노트 draft를 저장하지 못했습니다.",
  documentOriginalLoadFailed: "원본 문서를 불러오지 못했습니다.",
  queryFailed: "질의에 실패했습니다.",
  aiModelsLoadFailed: "AI 모델 목록을 불러오지 못했습니다.",
  agentTurnFailed: "AI 편집 요청에 실패했습니다.",
  chatLoadFailed: "채팅 기록을 불러오지 못했습니다.",
  chatSessionFailed: "채팅 세션을 준비하지 못했습니다.",
  documentsLoadFailed: "문서 목록을 불러오지 못했습니다.",
  wikiExportFailed: "위키 내보내기에 실패했습니다.",
  wikiGraphLoadFailed: "Wiki graph를 불러오지 못했습니다.",
  wikiPageLoadFailed: "Wiki page를 불러오지 못했습니다.",
  workspaceLoadFailed: "워크스페이스를 불러오지 못했습니다.",
  schemaLoadFailed: "스킬을 불러오지 못했습니다.",
  schemaPreviewFailed: "스킬 미리보기를 생성하지 못했습니다.",
  schemaDraftFailed: "스킬 초안을 저장하지 못했습니다.",
  schemaActivateFailed: "스킬을 활성화하지 못했습니다.",
  schemaInvalid: "스킬 정의가 올바르지 않습니다. 내용을 확인해 주세요.",
  schemaNotFound: "스킬 또는 워크스페이스를 찾을 수 없습니다.",
  schemaUnavailable: "스킬 해석 서버를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  meLoadFailed: "사용자 정보를 불러오지 못했습니다.",
  authRefreshUnavailable: "인증을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요."
} as const;

// HTTP 응답에서 에러 메시지를 추출하는 공통 헬퍼
export async function parseErrorResponse(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as {
      error?: { message?: string };
      detail?: string | { message?: string };
    } | undefined;
    const detailMessage = typeof body?.detail === "string" ? body.detail : body?.detail?.message;
    return body?.error?.message || detailMessage || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 재발급 결과.
 * rejected: 서버가 refresh token을 거절(401·403)했다. 세션이 끝났다.
 * unavailable: 네트워크 오류·5xx·토큰 없는 응답처럼 다시 시도하면 회복될 수 있는 실패다.
 */
type RefreshOutcome = "refreshed" | "rejected" | "unavailable";

// 동시 401들이 refresh를 중복 호출하지 않도록 진행 중인 재발급을 공유한다.
let refreshPromise: Promise<RefreshOutcome> | null = null;

async function tryRefreshTokens(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = withAuthRefreshLock(async (): Promise<RefreshOutcome> => {
      try {
        const response = await fetch("/api/auth/refresh", {
          method: "POST"
        });
        if (response.status === 401 || response.status === 403) return "rejected";
        if (!response.ok) return "unavailable";
        const body = await response.json() as { access_token?: string };
        if (!body.access_token) return "unavailable";
        saveAccessToken(body.access_token);
        return "refreshed";
      } catch {
        return "unavailable";
      }
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function fetchWithToken(path: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

/**
 * Bearer 토큰을 부착하는 공통 fetch.
 * access token 만료(401) 시 refresh token으로 재발급을 1회 시도하고 원요청을 재시도한다.
 * refresh token이 거절됐거나, 재발급 뒤에도 401이면 세션 만료로 보고 SessionExpiredError를 던진다.
 * 재발급이 일시적으로 실패하면 세션 만료가 아니므로 일반 에러를 던져 호출부가 다시 시도하게 한다.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let requestPath = path;
  let requestInit = init;
  if (typeof window !== "undefined" && usesDocumentTransport(path)) {
    // 본문 없이 접근 코드 게이트를 확인한 뒤, 대용량 본문은 AWS로 보낸다.
    const transport = await getDocumentTransport(init?.signal);
    if (transport.origin) {
      requestPath = transport.origin + path;
      requestInit = { ...init, credentials: "omit" };
    }
  }
  const response = await fetchWithToken(requestPath, requestInit);
  if (response.status !== 401) return response;
  // 비밀번호·MFA 코드 불일치를 서버가 code로 밝히면 재발급을 시도할 이유가 없다.
  // 다만 본문이 비어 있거나 code가 없어도 세션 만료로 단정하지 않는다(아래 재발급 성공 분기).
  if (await isCredentialRejection(path, response)) return response;
  // 로그인·회원가입 등 인증 요청 자체의 401은 재발급 대상이 아니지만, /me는 보호된 요청이다.
  const canRefresh = path === "/api/auth/me" || path.startsWith("/api/auth/me/") || !path.startsWith("/api/auth/");
  // 재발급 대상이 아닌 요청의 401은 요청 자체가 거절된 것이다. 호출부가 응답을 읽어 안내한다.
  if (!canRefresh) return response;
  const outcome = await tryRefreshTokens();
  // 터널·엘리베이터 같은 일시적인 연결 상실은 세션 만료가 아니다. 재로그인을 안내하지 않는다.
  if (outcome === "unavailable") throw new Error(ERROR_MESSAGES.authRefreshUnavailable);
  if (outcome === "refreshed") {
    const retried = await fetchWithToken(requestPath, requestInit);
    if (retried.status !== 401) return retried;
    // 비밀번호·MFA 확인 요청의 401은 세션이 살아 있어도 입력이 틀리면 온다.
    // 본문이 비어 있거나 code가 없어도 호출부가 입력 오류로 안내하게 응답을 넘긴다.
    if (credentialRejectionCode(path)) return retried;
  }
  // 호출부마다 처리하면 대부분 놓치므로, 세션 만료는 한 곳에서 재인증으로 이어 붙인다.
  notifySessionExpired();
  throw new SessionExpiredError(ERROR_MESSAGES.loginRequired);
}

/** 서버가 code로 밝힌 자격 증명 확인 실패. 참이면 재발급 없이 응답을 호출부에 넘긴다. */
async function isCredentialRejection(path: string, response: Response): Promise<boolean> {
  const expectedCode = credentialRejectionCode(path);
  if (!expectedCode) return false;
  const body = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
  return body?.error?.code === expectedCode;
}

/** 입력한 비밀번호·MFA 코드를 확인하는 요청이면, 서버가 불일치를 알리는 code. */
function credentialRejectionCode(path: string): string | null {
  return path === "/api/auth/me/password" ? "INVALID_CREDENTIALS"
    : path === "/api/auth/me/mfa" || path === "/api/auth/me/mfa/activate" ? "INVALID_MFA_CODE" : null;
}

/** 응답이 실패(!ok)면 에러 메시지를 추출해 던진다. 본문이 필요 없는 요청에서 사용한다. */
export async function throwIfNotOk(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    throw new Error(await parseErrorResponse(response, fallbackMessage));
  }
}

export async function parseJsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await parseErrorResponse(response, fallback));
  }
  return response.json() as Promise<T>;
}

/** 워크스페이스 선택 화면에서 저장한 workspace id를 사용한다. */
export function getWorkspaceId(): string {
  const selected = getSelectedWorkspaceId();
  if (!selected) {
    throw new Error(ERROR_MESSAGES.workspaceRequired);
  }
  return selected;
}

/** /api/workspaces/{workspaceId}/... 경로 생성. 모든 segment를 encodeURIComponent 처리한다. */
export function workspacePath(workspaceId: string, ...segments: (string | number)[]): string {
  return (
    `/api/workspaces/${encodeURIComponent(workspaceId)}` +
    segments.map((segment) => `/${encodeURIComponent(String(segment))}`).join("")
  );
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

/** JSON 본문을 보내는 멱등 변경 요청의 기본 헤더. */
export function idempotentJsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() };
}
