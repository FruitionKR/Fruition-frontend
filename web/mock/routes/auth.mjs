// access-svc(8081) 인증 라우트: 로그인·회원가입·토큰 재발급·MFA·계정 설정·세션.
import { createHash, randomUUID } from "node:crypto";
import { issueAccessToken } from "../lib/http.mjs";
import { state, now, id, error, avatarUrlOf } from "../state.mjs";

const REFRESH_COOKIE = "refresh";
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 14;
const VERIFICATION_TTL_SECONDS = 300;
// 서버 설정 LEGAL_TERMS_VERSION과 같은 역할. 프론트 상수(src/shared/config/legal.ts)와 맞춰 둔다.
const LEGAL_TERMS_VERSION = process.env.MOCK_TERMS_VERSION ?? "2026-10-01";
// 서버 설정 LEGAL_CONSENT_REQUIRED(app.legal.consent-required)와 같은 역할. false면 동의를 검사·기록하지 않고 consent_required=false다.
// 프론트 NEXT_PUBLIC_LEGAL_PAGES_ENABLED와 짝을 맞춰 띄운다(꺼짐 ⇔ MOCK_LEGAL_CONSENT_REQUIRED=false).
const LEGAL_CONSENT_REQUIRED = process.env.MOCK_LEGAL_CONSENT_REQUIRED !== "false";
const SIGNUP_TOKEN_TTL_MS = 10 * 60_000;
// 비밀번호가 없는 소셜 계정은 이 시간 안에 직접 로그인한 토큰으로만 탈퇴할 수 있다.
const REAUTH_WINDOW_MS = 10 * 60_000;

const OAUTH_PROVIDERS = new Set(["google", "kakao", "naver"]);
// 연동 시작 토큰·콜백 code → { userId, provider }. 실제 서버처럼 1회용이다.
const oauthLinkTokens = new Map();
const oauthLinkCodes = new Map();
// 소셜 신규 가입 토큰 → { provider, email, expiresAt }. 10분, 1회용.
const oauthSignupTokens = new Map();
// mock에는 provider별 소셜 계정이 하나뿐이다. 그 소셜 계정의 이메일(연동·가입 때 정해짐). 없으면 provider 기본 이메일.
const oauthIdentityEmails = new Map();

function oauthIdentityEmail(provider) {
  return oauthIdentityEmails.get(provider) ?? `${provider}.user@fruition.local`;
}

/** 같은 이메일의 계정들이 가진 로그인 수단. 이메일 가입은 "local", 소셜은 provider 이름(이름순). */
function loginProvidersOf(users) {
  const providers = new Set();
  for (const user of users) {
    if (user.provider === "email") providers.add("local");
    for (const provider of linkedProviders(user)) providers.add(provider);
  }
  return [...providers].sort();
}

function usersWithEmail(email) {
  return state.users.filter((user) => user.email === String(email ?? "").toLowerCase());
}

/** 같은 이메일의 계정이 있어 가입을 거절하는 409. 이메일 가입 계정이면 DUPLICATE_EMAIL, 소셜 가입 계정만 있으면 EMAIL_REGISTERED_WITH_OAUTH(access #31). */
function rejectRegisteredEmail(ctx, email) {
  const sameEmail = usersWithEmail(email);
  if (sameEmail.length === 0) return false;
  if (sameEmail.some((user) => user.provider === "email")) {
    error(ctx, 409, "이미 가입된 이메일입니다.", "DUPLICATE_EMAIL");
    return true;
  }
  const oauth_providers = loginProvidersOf(sameEmail);
  ctx.json(409, {
    error: { code: "EMAIL_REGISTERED_WITH_OAUTH", message: `이미 소셜 계정(${oauth_providers.join(", ")})으로 가입된 이메일입니다. 그 계정으로 로그인한 뒤 설정에서 연동하세요.` },
    oauth_providers
  });
  return true;
}

/** 로그인 수단으로 연결된 소셜 provider. 소셜로 가입한 사용자는 가입 provider가 처음부터 연결돼 있다. */
function linkedProviders(user) {
  user.oauth_providers ??= OAUTH_PROVIDERS.has(user.provider) ? [user.provider] : [];
  return user.oauth_providers;
}

/** 가장 최근 동의의 이용약관 버전이 현재 버전과 다르면(동의 기록이 없는 기존 회원 포함) 재동의 대상이다. */
function consentRequired(user) {
  return LEGAL_CONSENT_REQUIRED && user.consent?.terms_version !== LEGAL_TERMS_VERSION;
}

function toMe(user) {
  return {
    id: user.id, email: user.email, display_name: user.display_name, avatar_url: avatarUrlOf(user), created_at: user.created_at,
    oauth_providers: [...linkedProviders(user)].sort(), consent_required: consentRequired(user)
  };
}

/** 동의 본문 검사. 만 18세 확인과 현재 이용약관 버전이 없으면 null(→ 400 CONSENT_REQUIRED). */
function parseConsent(body) {
  const { age_confirmed, terms_version, marketing_opt_in } = body ?? {};
  if (age_confirmed !== true || terms_version !== LEGAL_TERMS_VERSION) return null;
  return { terms_version, privacy_version: LEGAL_TERMS_VERSION, marketing_opt_in: marketing_opt_in === true, consented_at: now() };
}

/** 가입 요청의 동의. 동의를 요구하지 않는 설정이면 검사·기록 없이 통과한다(consent=null). */
function readSignupConsent(body) {
  if (!LEGAL_CONSENT_REQUIRED) return { ok: true, consent: null };
  const consent = parseConsent(body);
  return { ok: Boolean(consent), consent };
}

function consentRequiredError(ctx) {
  return error(ctx, 400, "만 18세 이상 확인과 현재 이용약관 동의가 필요합니다.", "CONSENT_REQUIRED");
}

function newUser(fields) {
  return { id: id("user"), display_name: null, created_at: now(), mfa: { enabled: false, activated_at: null, secret: null, recovery_codes: [] }, ...fields };
}

function startSession(ctx, user) {
  const refresh = randomUUID();
  const session = {
    session_id: state.loginSessions.length + 1,
    user_id: user.id,
    user_agent: ctx.req.headers["user-agent"] ?? null,
    refresh,
    created_at: now(),
    expires_at: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString()
  };
  state.loginSessions.push(session);
  state.refreshTokens.set(refresh, user.id);
  ctx.setCookie(REFRESH_COOKIE, refresh, REFRESH_TTL_SECONDS);
  return { access_token: issueAccessToken(state, user.id, { authTime: Date.now() }), mfa_required: false, consent_required: consentRequired(user) };
}

function issueTokensOrMfa(ctx, user) {
  if (!user.mfa.enabled) return ctx.json(200, startSession(ctx, user));
  const mfaToken = id("mfa");
  state.mfaTokens.set(mfaToken, user.id);
  ctx.json(200, { mfa_required: true, mfa_token: mfaToken });
}

function isSixDigits(code) {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

/** 토큰이 그 주소·목적으로 발급됐는지. 다른 주소·목적의 토큰은 실제 서버처럼 쓸 수 없다. */
function verificationTokenMatches(token, email, purpose) {
  const issued = state.verificationTokens.get(token);
  return Boolean(issued) && issued.purpose === purpose && issued.email === String(email ?? "").trim().toLowerCase();
}

// 본인 확인 실패 횟수 제한. 실제 서버의 기본값(5분에 5회)과 같다. 비밀번호 실패는 비밀번호 변경·회원 탈퇴와 공유하는 한도다.
const VERIFY_FAILURE_LIMIT = 5;
const VERIFY_FAILURE_WINDOW_MS = 5 * 60_000;
const verifyFailures = new Map();

function failureKey(kind, userId) {
  return `${kind}:${userId}`;
}

/** 한도를 넘었으면 남은 초, 아니면 0. */
function rateLimitedSeconds(kind, userId) {
  const recent = (verifyFailures.get(failureKey(kind, userId)) ?? []).filter((at) => Date.now() - at < VERIFY_FAILURE_WINDOW_MS);
  if (recent.length < VERIFY_FAILURE_LIMIT) return 0;
  return Math.ceil((recent[0] + VERIFY_FAILURE_WINDOW_MS - Date.now()) / 1000);
}

function recordFailure(kind, userId) {
  const key = failureKey(kind, userId);
  verifyFailures.set(key, [...(verifyFailures.get(key) ?? []), Date.now()]);
}

function rateLimited(ctx, seconds, message, code) {
  ctx.json(429, { error: { message, code } }, { "Retry-After": String(seconds) });
}

export function registerAuthRoutes(router) {
  router.post("/api/auth/login", async (ctx) => {
    const { email, password } = await ctx.body();
    const user = state.users.find((item) => item.email === String(email ?? "").toLowerCase());
    if (!user || user.password !== password) {
      return error(ctx, 401, "이메일 또는 비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
    }
    issueTokensOrMfa(ctx, user);
  }, { open: true });

  router.post("/api/auth/login/mfa", async (ctx) => {
    const { mfa_token, code } = await ctx.body();
    const userId = state.mfaTokens.get(mfa_token);
    const user = state.users.find((item) => item.id === userId);
    if (!user || !isSixDigits(code)) return error(ctx, 401, "인증 코드가 올바르지 않습니다.", "INVALID_MFA_CODE");
    state.mfaTokens.delete(mfa_token);
    ctx.json(200, startSession(ctx, user));
  }, { open: true });

  // OAuth 시작: next.config redirects()가 이 주소로 보낸다. 로그인 페이지로 code를 돌려준다.
  // 연동 모드(mode=link)면 link_token을 소비하고 콜백 페이지로 link_code(실패 시 link=failed)를 돌려준다.
  router.get("/oauth2/authorization/:provider", (ctx) => {
    if (ctx.query.get("mode") === "link") {
      const token = ctx.query.get("link_token");
      const pending = token ? oauthLinkTokens.get(token) : null;
      if (token) oauthLinkTokens.delete(token);
      if (!pending || pending.provider !== ctx.params.provider) return ctx.redirect("http://localhost:3000/oauth/callback?link=failed");
      const linkCode = id("link_code");
      oauthLinkCodes.set(linkCode, pending);
      return ctx.redirect(`http://localhost:3000/oauth/callback?link_code=${linkCode}`);
    }
    const { provider } = ctx.params;
    if (!OAUTH_PROVIDERS.has(provider)) return ctx.redirect("http://localhost:3000/login?error=oauth_failed");
    // 그 provider로 연결된 사용자가 없으면 처음 들어온 소셜 계정이다. 계정을 만들지 않고 signup_token으로 돌려보낸다.
    // 시드에서는 Google이 김지현에 연결돼 있어 Google은 기존 회원 로그인, 카카오·네이버는 신규 가입 흐름이다.
    if (!state.users.some((user) => linkedProviders(user).includes(provider))) {
      // 같은 이메일의 계정이 이미 있으면(연동을 해제한 소셜 계정으로 다시 로그인한 경우 등) 두 번째 계정을 만들지 않는다(access #31).
      const email = oauthIdentityEmail(provider);
      const registered = usersWithEmail(email);
      if (registered.length > 0) {
        return ctx.redirect(`http://localhost:3000/login?error=email_registered&providers=${loginProvidersOf(registered).join(",")}`);
      }
      const signupToken = id("signup");
      oauthSignupTokens.set(signupToken, { provider, email, expiresAt: Date.now() + SIGNUP_TOKEN_TTL_MS });
      return ctx.redirect(`http://localhost:3000/login?signup_token=${signupToken}`);
    }
    ctx.redirect(`http://localhost:3000/login?code=mock-${provider}`);
  }, { open: true });

  router.post("/api/auth/oauth/exchange", async (ctx) => {
    const { code } = await ctx.body();
    if (typeof code !== "string" || !code.startsWith("mock-")) return error(ctx, 400, "OAuth 코드가 올바르지 않습니다.");
    const provider = code.slice("mock-".length);
    const user = state.users.find((item) => linkedProviders(item).includes(provider)) ?? state.users[0];
    issueTokensOrMfa(ctx, user);
  }, { open: true });

  // 소셜 신규 가입 확정: 동의를 받아 계정을 만들고 로그인 응답을 돌려준다.
  router.post("/api/auth/oauth/signup/consent", async (ctx) => {
    const body = await ctx.body();
    const pending = oauthSignupTokens.get(body.signup_token);
    if (!pending || pending.expiresAt < Date.now()) {
      oauthSignupTokens.delete(body.signup_token);
      return error(ctx, 401, "가입 요청이 만료되었거나 이미 사용되었습니다.", "INVALID_SIGNUP_TOKEN");
    }
    // 동의가 빠졌으면 토큰은 소비하지 않아 고쳐서 다시 보낼 수 있다.
    const { ok: hasConsent, consent } = readSignupConsent(body);
    if (!hasConsent) return consentRequiredError(ctx);
    oauthSignupTokens.delete(body.signup_token);
    // 다른 탭이 먼저 가입을 끝냈으면 그 계정으로 로그인한다(MFA를 켰으면 mfa_required).
    const existing = state.users.find((item) => linkedProviders(item).includes(pending.provider));
    if (existing) return issueTokensOrMfa(ctx, existing);
    // 동의 화면에 머무는 사이 같은 이메일로 다른 가입이 끝났으면 토큰은 소비된 채 409로 거절한다(access #31).
    const registered = usersWithEmail(pending.email);
    if (registered.length > 0) {
      const providers = loginProvidersOf(registered);
      return ctx.json(409, {
        error: { code: "EMAIL_REGISTERED", message: `이미 가입된 이메일입니다(${providers.join(", ")}). 기존 계정으로 로그인한 뒤 설정에서 연동하세요.` },
        providers
      });
    }
    const user = newUser({ email: pending.email, password: null, display_name: `${pending.provider} 사용자`, provider: pending.provider, consent });
    state.users.push(user);
    oauthIdentityEmails.set(pending.provider, user.email);
    ctx.json(200, startSession(ctx, user));
  }, { open: true });

  router.post("/api/auth/refresh", (ctx) => {
    const refresh = ctx.cookies[REFRESH_COOKIE];
    const userId = refresh ? state.refreshTokens.get(refresh) : null;
    if (!userId) return error(ctx, 401, "다시 로그인해주세요.");
    ctx.json(200, { access_token: issueAccessToken(state, userId) });
  }, { open: true });

  router.post("/api/auth/logout", (ctx) => {
    const refresh = ctx.cookies[REFRESH_COOKIE];
    if (refresh) {
      state.refreshTokens.delete(refresh);
      state.loginSessions = state.loginSessions.filter((session) => session.refresh !== refresh);
    }
    ctx.setCookie(REFRESH_COOKIE, "", 0);
    ctx.json(204);
  }, { open: true });

  router.post("/api/auth/email-availability", async (ctx) => {
    const { email } = await ctx.body();
    // 실제 서버처럼 같은 이메일의 계정이 하나라도 있으면(이메일 가입이든 소셜 가입이든) available=false.
    // 소셜 가입 계정은 oauth_providers로 알려 그 소셜 로그인 뒤 연동을 안내하게 한다(access #31).
    const sameEmail = usersWithEmail(email);
    const oauth_providers = [...new Set(sameEmail.flatMap((user) => linkedProviders(user)))].sort();
    ctx.json(200, { available: sameEmail.length === 0, oauth_providers });
  }, { open: true });

  router.post("/api/auth/email-verifications", async (ctx) => {
    const { email, purpose } = await ctx.body();
    // 가입 목적이면 같은 이메일의 계정이 있을 때 인증번호를 만들지 않고 409로 거절한다. password_reset은 존재 여부를 노출하지 않는다.
    if (purpose === "signup" && rejectRegisteredEmail(ctx, email)) return;
    const verificationId = id("verify");
    state.verifications.set(verificationId, { email, purpose });
    console.log(`[mock] 이메일 인증번호(${purpose}) ${email}: 아무 6자리 숫자나 입력하면 됩니다 (개발 코드 9700도 허용)`);
    ctx.json(200, { verification_id: verificationId, expires_in: VERIFICATION_TTL_SECONDS, retry_after: 30 });
  }, { open: true });

  router.post("/api/auth/email-verifications/:verificationId/confirm", async (ctx) => {
    const verification = state.verifications.get(ctx.params.verificationId);
    const { code } = await ctx.body();
    if (!verification || !/^\d{4,6}$/.test(String(code ?? ""))) return error(ctx, 400, "인증번호가 올바르지 않습니다.");
    const token = id("vt");
    // 발급한 주소(trim·소문자)와 목적에 묶는다.
    state.verificationTokens.set(token, { email: String(verification.email ?? "").trim().toLowerCase(), purpose: verification.purpose });
    ctx.json(200, { verification_token: token, expires_in: VERIFICATION_TTL_SECONDS });
  }, { open: true });

  router.post("/api/auth/signup", async (ctx) => {
    const body = await ctx.body();
    const { email, password, display_name, verification_token } = body;
    if (!verificationTokenMatches(verification_token, email, "signup")) return error(ctx, 400, "이메일 인증이 필요합니다.");
    const normalized = String(email ?? "").toLowerCase();
    if (rejectRegisteredEmail(ctx, normalized)) return;
    // 동의가 빠지거나 약관 버전이 다르면 거절한다. 인증 토큰은 소비하지 않아 동의만 고쳐 다시 보낼 수 있다.
    const { ok: hasConsent, consent } = readSignupConsent(body);
    if (!hasConsent) return consentRequiredError(ctx);
    state.verificationTokens.delete(verification_token);
    state.users.push(newUser({ email: normalized, password, display_name: display_name || null, provider: "email", consent }));
    ctx.json(201, { ok: true });
  }, { open: true });

  router.post("/api/auth/password-reset", async (ctx) => {
    const { email, new_password, verification_token } = await ctx.body();
    const user = state.users.find((item) => item.email === String(email ?? "").toLowerCase());
    if (!user || !verificationTokenMatches(verification_token, email, "password_reset")) return error(ctx, 400, "비밀번호를 재설정할 수 없습니다.");
    state.verificationTokens.delete(verification_token);
    user.password = new_password;
    ctx.json(204);
  }, { open: true });

  router.get("/api/auth/me", (ctx) => ctx.json(200, toMe(ctx.user)));

  // 이용약관이 바뀐 기존 회원의 재동의. 시드 사용자는 동의 기록이 없어 첫 로그인 뒤 한 번 거친다.
  router.post("/api/auth/me/consents", async (ctx) => {
    const consent = parseConsent(await ctx.body());
    if (!consent) return consentRequiredError(ctx);
    ctx.user.consent = consent;
    ctx.json(204);
  });

  // 회원 탈퇴. 비밀번호 계정은 비밀번호, 소셜 계정은 10분 안의 직접 로그인 토큰, MFA 계정은 코드로 본인을 확인한다.
  router.delete("/api/auth/me", async (ctx) => {
    const { password, mfa_code } = await ctx.body();
    const user = ctx.user;
    if (user.password) {
      if (password !== user.password) return error(ctx, 401, "비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
    } else if (!ctx.session.authTime || Date.now() - ctx.session.authTime > REAUTH_WINDOW_MS) {
      return error(ctx, 401, "본인 확인을 위해 다시 로그인해 주세요.", "REAUTHENTICATION_REQUIRED");
    }
    if (user.mfa.enabled && !isSixDigits(mfa_code) && !user.mfa.recovery_codes.includes(mfa_code)) {
      return error(ctx, 401, "인증 코드가 올바르지 않습니다.", "INVALID_MFA_CODE");
    }
    // 다른 멤버가 있는 워크스페이스의 유일한 OWNER면 거절하고 넘겨야 할 워크스페이스를 알려 준다.
    const soleOwnerOf = state.workspaces.filter((workspace) => {
      if (workspace.deleted_at) return false;
      const members = state.members.filter((member) => member.workspace_id === workspace.id);
      const owners = members.filter((member) => member.role === "OWNER");
      return members.length > 1 && owners.length === 1 && owners[0].user_id === user.id;
    });
    if (soleOwnerOf.length > 0) {
      return ctx.json(409, {
        error: { code: "SOLE_OWNER_OF_SHARED_WORKSPACE", message: "다른 멤버가 있는 워크스페이스의 OWNER를 먼저 넘겨 주세요." },
        workspaces: soleOwnerOf.map(({ id, name }) => ({ id, name }))
      });
    }
    // 혼자 쓰던 워크스페이스는 함께 지운다(document 데이터 파기는 비동기지만 mock에서는 즉시).
    const soloWorkspaceIds = new Set(state.workspaces
      .filter((workspace) => state.members.filter((member) => member.workspace_id === workspace.id).every((member) => member.user_id === user.id))
      .filter((workspace) => state.members.some((member) => member.workspace_id === workspace.id && member.user_id === user.id))
      .map((workspace) => workspace.id));
    state.workspaces = state.workspaces.filter((workspace) => !soloWorkspaceIds.has(workspace.id));
    state.members = state.members.filter((member) => member.user_id !== user.id && !soloWorkspaceIds.has(member.workspace_id));
    state.documents = state.documents.filter((doc) => !soloWorkspaceIds.has(doc.workspace_id));
    state.loginSessions = state.loginSessions.filter((session) => session.user_id !== user.id);
    for (const [refresh, userId] of state.refreshTokens) if (userId === user.id) state.refreshTokens.delete(refresh);
    for (const [token, session] of state.tokens) if (session.userId === user.id) state.tokens.delete(token);
    state.users = state.users.filter((item) => item !== user);
    ctx.setCookie(REFRESH_COOKIE, "", 0);
    ctx.json(204);
  });

  router.patch("/api/auth/me", async (ctx) => {
    const { display_name } = await ctx.body();
    ctx.user.display_name = typeof display_name === "string" && display_name.trim() ? display_name.trim() : ctx.user.display_name;
    ctx.json(200, toMe(ctx.user));
  });

  // 프로필 사진: 서버처럼 매직 바이트로 형식을 판별하고 1MB를 넘으면 413이다.
  const AVATAR_MAX_BYTES = 1024 * 1024;
  function imageTypeOf(buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
    return null;
  }

  router.put("/api/auth/me/avatar", async (ctx) => {
    const { file } = await ctx.body();
    if (!file?.buffer) return error(ctx, 400, "이미지 파일이 필요합니다.", "INVALID_REQUEST");
    if (file.buffer.length > AVATAR_MAX_BYTES) return error(ctx, 413, "프로필 사진은 1MB 이하여야 합니다.", "USER_AVATAR_TOO_LARGE");
    const type = imageTypeOf(file.buffer);
    if (!type) return error(ctx, 400, "PNG·JPEG·WebP·GIF 이미지만 올릴 수 있습니다.", "UNSUPPORTED_USER_AVATAR");
    ctx.user.avatar = { type, buffer: file.buffer, hash: createHash("sha256").update(file.buffer).digest("hex") };
    ctx.json(200, toMe(ctx.user));
  });

  router.delete("/api/auth/me/avatar", (ctx) => {
    ctx.user.avatar = null;
    ctx.json(200, toMe(ctx.user));
  });

  // 본인이거나 워크스페이스를 하나라도 같이 쓰는 멤버만 본다. 아니면 404로 존재를 숨긴다.
  router.get("/api/users/:uid/avatar", (ctx) => {
    const target = state.users.find((user) => user.id === ctx.params.uid);
    const shares = target && (target.id === ctx.user.id || state.members.some((mine) => mine.user_id === ctx.user.id &&
      state.members.some((theirs) => theirs.user_id === target.id && theirs.workspace_id === mine.workspace_id)));
    if (!shares) return error(ctx, 404, "사용자를 찾을 수 없습니다.", "USER_NOT_FOUND");
    if (!target.avatar) return error(ctx, 404, "프로필 사진이 없습니다.", "USER_AVATAR_NOT_FOUND");
    const headers = { ETag: `"${target.avatar.hash}"`, "Cache-Control": "no-cache, private" };
    if (ctx.req.headers["if-none-match"] === headers.ETag) return ctx.bytes(304, Buffer.alloc(0), target.avatar.type, headers);
    ctx.bytes(200, target.avatar.buffer, target.avatar.type, headers);
  });

  router.put("/api/auth/me/password", async (ctx) => {
    const { current_password, new_password } = await ctx.body();
    if (current_password !== ctx.user.password) return error(ctx, 401, "현재 비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
    ctx.user.password = new_password;
    ctx.json(204);
  });

  // 이메일 변경. 회원 탈퇴와 같은 본인 확인을 토큰 검증보다 먼저 한다. 본인 확인 실패(401·429)는 토큰을 소비하지 않는다.
  router.put("/api/auth/me/email", async (ctx) => {
    const { new_email, verification_token, current_password, mfa_code } = await ctx.body();
    const user = ctx.user;
    const normalized = typeof new_email === "string" ? new_email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+$/.test(normalized) || normalized.length > 255) {
      return error(ctx, 400, "이메일 형식이 올바르지 않습니다.", "INVALID_REQUEST");
    }
    if (user.password) {
      const waitSeconds = rateLimitedSeconds("password", user.id);
      if (waitSeconds > 0) return rateLimited(ctx, waitSeconds, "비밀번호 확인 시도가 너무 많습니다.", "PASSWORD_CHANGE_RATE_LIMITED");
      if (current_password !== user.password) {
        recordFailure("password", user.id);
        return error(ctx, 401, "비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
      }
    } else if (!ctx.session.authTime || Date.now() - ctx.session.authTime > REAUTH_WINDOW_MS) {
      return error(ctx, 401, "본인 확인을 위해 다시 로그인해 주세요.", "REAUTHENTICATION_REQUIRED");
    }
    if (user.mfa.enabled) {
      const waitSeconds = rateLimitedSeconds("mfa", user.id);
      if (waitSeconds > 0) return rateLimited(ctx, waitSeconds, "인증 코드 확인 시도가 너무 많습니다.", "MFA_RATE_LIMITED");
      if (!isSixDigits(mfa_code) && !user.mfa.recovery_codes.includes(mfa_code)) {
        recordFailure("mfa", user.id);
        return error(ctx, 401, "인증 코드가 올바르지 않습니다.", "INVALID_MFA_CODE");
      }
    }
    if (!verificationTokenMatches(verification_token, normalized, "email_change")) {
      return error(ctx, 400, "이메일 인증이 만료되었거나 다른 주소로 발급되었습니다.", "INVALID_VERIFICATION_TOKEN");
    }
    if (state.users.some((other) => other !== user && other.email === normalized && other.provider === user.provider)) {
      return error(ctx, 409, "이미 사용 중인 이메일입니다.", "DUPLICATE_EMAIL");
    }
    state.verificationTokens.delete(verification_token);
    const previousEmail = user.email;
    user.email = normalized;
    // 현재 세션만 남기고 나머지 refresh 토큰을 폐기한다. 쿠키가 없으면 모두 폐기한다.
    const current = ctx.cookies[REFRESH_COOKIE];
    for (const session of state.loginSessions.filter((item) => item.user_id === user.id && item.refresh !== current)) {
      state.refreshTokens.delete(session.refresh);
    }
    state.loginSessions = state.loginSessions.filter((item) => item.user_id !== user.id || item.refresh === current);
    if (previousEmail !== normalized) console.log(`[mock] 이메일 변경 알림: ${previousEmail} → ${normalized}`);
    ctx.json(200, toMe(user));
  });

  router.post("/api/auth/me/oauth-accounts/:provider/link", (ctx) => {
    const { provider } = ctx.params;
    if (!OAUTH_PROVIDERS.has(provider)) return error(ctx, 404, "지원하지 않는 OAuth provider입니다.", "UNSUPPORTED_OAUTH_PROVIDER");
    const linkToken = id("link_token");
    oauthLinkTokens.set(linkToken, { userId: ctx.user.id, provider });
    ctx.json(200, { link_token: linkToken });
  });

  router.post("/api/auth/me/oauth-accounts/link/confirm", async (ctx) => {
    const { link_code } = await ctx.body();
    const pending = oauthLinkCodes.get(link_code);
    oauthLinkCodes.delete(link_code);
    if (!pending || pending.userId !== ctx.user.id) return error(ctx, 400, "연동 code가 유효하지 않습니다.", "INVALID_OAUTH_LINK_CODE");
    const providers = linkedProviders(ctx.user);
    if (providers.includes(pending.provider)) return ctx.json(204);
    // mock에는 provider별 소셜 계정이 하나뿐이라, 다른 사용자가 이미 연결했으면 같은 소셜 계정으로 본다.
    // 시드의 김지현(google)이 있어 데모 사용자의 Google 연동은 409, 카카오·네이버는 성공한다.
    const takenByOther = state.users.some((user) => user !== ctx.user && linkedProviders(user).includes(pending.provider));
    if (takenByOther) return error(ctx, 409, "이미 다른 계정에 연결된 소셜 계정입니다.", "OAUTH_ACCOUNT_ALREADY_LINKED");
    providers.push(pending.provider);
    // 연동한 소셜 계정은 이 사용자의 이메일을 쓴다. 해제 뒤 다시 로그인하면 같은 이메일의 계정이 있어 가입이 거절된다.
    oauthIdentityEmails.set(pending.provider, ctx.user.email);
    ctx.json(204);
  });

  router.delete("/api/auth/me/oauth-accounts/:provider", (ctx) => {
    const { provider } = ctx.params;
    const providers = linkedProviders(ctx.user);
    if (!providers.includes(provider)) return error(ctx, 404, "연결되지 않은 소셜 계정입니다.", "OAUTH_ACCOUNT_NOT_FOUND");
    if (provider === ctx.user.provider) return error(ctx, 409, "가입할 때 쓴 소셜 계정은 해제할 수 없습니다.", "OAUTH_UNLINK_NOT_ALLOWED");
    ctx.user.oauth_providers = providers.filter((item) => item !== provider);
    ctx.json(204);
  });

  router.get("/api/auth/me/mfa", (ctx) => {
    const { enabled, activated_at, recovery_codes } = ctx.user.mfa;
    ctx.json(200, { enabled, activated_at, remaining_recovery_codes: recovery_codes.length });
  });

  router.post("/api/auth/me/mfa", (ctx) => {
    const secret = randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const recovery = Array.from({ length: 8 }, () => randomUUID().slice(0, 8));
    ctx.user.mfa = { ...ctx.user.mfa, secret, pending_recovery_codes: recovery };
    ctx.json(200, {
      secret,
      otpauth_uri: `otpauth://totp/Fruition:${encodeURIComponent(ctx.user.email)}?secret=${secret}&issuer=Fruition`,
      recovery_codes: recovery
    });
  });

  router.post("/api/auth/me/mfa/activate", async (ctx) => {
    const { code } = await ctx.body();
    if (!ctx.user.mfa.secret || !isSixDigits(code)) return error(ctx, 401, "인증 코드가 올바르지 않습니다.", "INVALID_MFA_CODE");
    ctx.user.mfa = { enabled: true, activated_at: now(), secret: ctx.user.mfa.secret, recovery_codes: ctx.user.mfa.pending_recovery_codes ?? [] };
    ctx.json(204);
  });

  router.delete("/api/auth/me/mfa", async (ctx) => {
    const { code } = await ctx.body();
    if (!isSixDigits(code)) return error(ctx, 401, "인증 코드가 올바르지 않습니다.", "INVALID_MFA_CODE");
    ctx.user.mfa = { enabled: false, activated_at: null, secret: null, recovery_codes: [] };
    ctx.json(204);
  });

  router.get("/api/auth/me/sessions", (ctx) => {
    const current = ctx.cookies[REFRESH_COOKIE];
    const sessions = state.loginSessions
      .filter((session) => session.user_id === ctx.user.id)
      .map(({ session_id, user_agent, created_at, expires_at, refresh }) => ({ session_id, user_agent, created_at, expires_at, current: refresh === current }));
    ctx.json(200, { sessions });
  });

  router.delete("/api/auth/me/sessions/:sessionId", (ctx) => {
    const target = state.loginSessions.find((session) => String(session.session_id) === ctx.params.sessionId && session.user_id === ctx.user.id);
    if (!target) return error(ctx, 404, "세션을 찾을 수 없습니다.");
    state.refreshTokens.delete(target.refresh);
    state.loginSessions = state.loginSessions.filter((session) => session !== target);
    ctx.json(204);
  });
}
