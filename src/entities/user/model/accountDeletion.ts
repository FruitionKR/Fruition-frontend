// 회원 탈퇴(DELETE /api/auth/me)에 쓰는 순수 로직: 요청 본문, 오류 안내, 409 워크스페이스 목록.

export type AccountDeletionBody = { password?: string; mfa_code?: string };

/** 빈 값은 보내지 않는다. 소셜 계정은 비밀번호 없이, MFA를 끈 계정은 코드 없이 요청한다. */
export function buildAccountDeletionBody(input: { password: string; mfaCode: string }): AccountDeletionBody {
  const body: AccountDeletionBody = {};
  if (input.password.trim()) body.password = input.password;
  if (input.mfaCode.trim()) body.mfa_code = input.mfaCode.trim();
  return body;
}

export const REAUTHENTICATION_REQUIRED_MESSAGE = "본인 확인을 위해 소셜 계정으로 다시 로그인한 뒤 10분 안에 탈퇴해 주세요.";

const ACCOUNT_DELETION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "비밀번호가 올바르지 않습니다.",
  INVALID_MFA_CODE: "인증 코드가 올바르지 않습니다.",
  REAUTHENTICATION_REQUIRED: REAUTHENTICATION_REQUIRED_MESSAGE,
  SOLE_OWNER_OF_SHARED_WORKSPACE: "다른 멤버가 있는 워크스페이스의 OWNER를 먼저 넘겨 주세요."
};

/** 탈퇴 실패를 서버 error.code 기준으로 안내한다. 429는 시도 제한, 모르는 code면 에러 메시지, 없으면 fallback. */
export function accountDeletionErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && ACCOUNT_DELETION_ERROR_MESSAGES[code]) return ACCOUNT_DELETION_ERROR_MESSAGES[code];
  if ((error as { status?: unknown } | null)?.status === 429) return "비밀번호 확인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 소셜 계정으로 다시 로그인해야 하는 실패인지. */
export function isReauthenticationRequired(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "REAUTHENTICATION_REQUIRED";
}

export type SoleOwnerWorkspace = { id: string; name: string };

/** 409 SOLE_OWNER_OF_SHARED_WORKSPACE 본문의 workspaces. 형식이 맞는 항목만 남긴다. */
export function parseSoleOwnerWorkspaces(body: unknown): SoleOwnerWorkspace[] {
  const list = (body as { workspaces?: unknown } | null)?.workspaces;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const id = (item as { id?: unknown } | null)?.id;
    const name = (item as { name?: unknown } | null)?.name;
    return typeof id === "string" && id ? [{ id, name: typeof name === "string" && name ? name : id }] : [];
  });
}

/** 탈퇴가 OWNER 이전 전까지 막혔다. workspaces를 보여 주고 멤버 관리로 보낸다. */
export class AccountDeletionBlockedError extends Error {
  readonly code = "SOLE_OWNER_OF_SHARED_WORKSPACE";
  readonly status = 409;
  readonly workspaces: SoleOwnerWorkspace[];

  constructor(message: string, workspaces: SoleOwnerWorkspace[]) {
    super(message);
    this.name = "AccountDeletionBlockedError";
    this.workspaces = workspaces;
  }
}
