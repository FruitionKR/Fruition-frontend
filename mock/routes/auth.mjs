// access-svc(8081) 인증 라우트: 로그인·회원가입·토큰 재발급·MFA·계정 설정·세션.
import { randomUUID } from "node:crypto";
import { issueAccessToken } from "../lib/http.mjs";
import { state, now, id, error } from "../state.mjs";

const REFRESH_COOKIE = "refresh";
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 14;
const VERIFICATION_TTL_SECONDS = 300;
// 서버 설정 LEGAL_TERMS_VERSION과 같은 역할. 프론트 상수(src/shared/config/legal.ts)와 맞춰 둔다.
const LEGAL_TERMS_VERSION = process.env.MOCK_TERMS_VERSION ?? "2026-10-01";
const SIGNUP_TOKEN_TTL_MS = 10 * 60_000;
// 비밀번호가 없는 소셜 계정은 이 시간 안에 직접 로그인한 토큰으로만 탈퇴할 수 있다.
const REAUTH_WINDOW_MS = 10 * 60_000;

const OAUTH_PROVIDERS = new Set(["google", "kakao", "naver"]);
// 연동 시작 토큰·콜백 code → { userId, provider }. 실제 서버처럼 1회용이다.
const oauthLinkTokens = new Map();
const oauthLinkCodes = new Map();
// 소셜 신규 가입 토큰 → { provider, expiresAt }. 10분, 1회용.
const oauthSignupTokens = new Map();

/** 로그인 수단으로 연결된 소셜 provider. 소셜로 가입한 사용자는 가입 provider가 처음부터 연결돼 있다. */
function linkedProviders(user) {
  user.oauth_providers ??= OAUTH_PROVIDERS.has(user.provider) ? [user.provider] : [];
  return user.oauth_providers;
}

/** 가장 최근 동의의 이용약관 버전이 현재 버전과 다르면(동의 기록이 없는 기존 회원 포함) 재동의 대상이다. */
function consentRequired(user) {
  return user.consent?.terms_version !== LEGAL_TERMS_VERSION;
}

function toMe(user) {
  return {
    id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at,
    oauth_providers: [...linkedProviders(user)].sort(), consent_required: consentRequired(user)
  };
}

/** 동의 본문 검사. 만 18세 확인과 현재 이용약관 버전이 없으면 null(→ 400 CONSENT_REQUIRED). */
function parseConsent(body) {
  const { age_confirmed, terms_version, marketing_opt_in } = body ?? {};
  if (age_confirmed !== true || terms_version !== LEGAL_TERMS_VERSION) return null;
  return { terms_version, privacy_version: LEGAL_TERMS_VERSION, marketing_opt_in: marketing_opt_in === true, consented_at: now() };
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
      const signupToken = id("signup");
      oauthSignupTokens.set(signupToken, { provider, expiresAt: Date.now() + SIGNUP_TOKEN_TTL_MS });
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
    const consent = parseConsent(body);
    if (!consent) return consentRequiredError(ctx);
    oauthSignupTokens.delete(body.signup_token);
    // 다른 탭이 먼저 가입을 끝냈으면 그 계정으로 로그인한다(MFA를 켰으면 mfa_required).
    const existing = state.users.find((item) => linkedProviders(item).includes(pending.provider));
    if (existing) return issueTokensOrMfa(ctx, existing);
    const user = newUser({ email: `${pending.provider}.user@fruition.local`, password: null, display_name: `${pending.provider} 사용자`, provider: pending.provider, consent });
    state.users.push(user);
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
    // 실제 서버처럼 일반 가입(email) 계정만 중복으로 보고, 소셜 가입 계정은 안내용 provider로만 알린다.
    const sameEmail = state.users.filter((user) => user.email === String(email ?? "").toLowerCase());
    const available = !sameEmail.some((user) => user.provider === "email");
    const oauth_providers = [...new Set(sameEmail.map((user) => user.provider).filter((provider) => OAUTH_PROVIDERS.has(provider)))].sort();
    ctx.json(200, { available, oauth_providers });
  }, { open: true });

  router.post("/api/auth/email-verifications", async (ctx) => {
    const { email, purpose } = await ctx.body();
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
    state.verificationTokens.add(token);
    ctx.json(200, { verification_token: token, expires_in: VERIFICATION_TTL_SECONDS });
  }, { open: true });

  router.post("/api/auth/signup", async (ctx) => {
    const body = await ctx.body();
    const { email, password, display_name, verification_token } = body;
    if (!state.verificationTokens.has(verification_token)) return error(ctx, 400, "이메일 인증이 필요합니다.");
    const normalized = String(email ?? "").toLowerCase();
    if (state.users.some((user) => user.email === normalized && user.provider === "email")) return error(ctx, 409, "이미 가입된 이메일입니다.");
    // 동의가 빠지거나 약관 버전이 다르면 거절한다. 인증 토큰은 소비하지 않아 동의만 고쳐 다시 보낼 수 있다.
    const consent = parseConsent(body);
    if (!consent) return consentRequiredError(ctx);
    state.verificationTokens.delete(verification_token);
    state.users.push(newUser({ email: normalized, password, display_name: display_name || null, provider: "email", consent }));
    ctx.json(201, { ok: true });
  }, { open: true });

  router.post("/api/auth/password-reset", async (ctx) => {
    const { email, new_password, verification_token } = await ctx.body();
    const user = state.users.find((item) => item.email === String(email ?? "").toLowerCase());
    if (!user || !state.verificationTokens.has(verification_token)) return error(ctx, 400, "비밀번호를 재설정할 수 없습니다.");
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

  router.put("/api/auth/me/password", async (ctx) => {
    const { current_password, new_password } = await ctx.body();
    if (current_password !== ctx.user.password) return error(ctx, 401, "현재 비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
    ctx.user.password = new_password;
    ctx.json(204);
  });

  router.put("/api/auth/me/email", async (ctx) => {
    const { new_email, verification_token } = await ctx.body();
    if (!state.verificationTokens.has(verification_token)) return error(ctx, 400, "이메일 인증이 필요합니다.");
    state.verificationTokens.delete(verification_token);
    ctx.user.email = String(new_email).toLowerCase();
    ctx.json(200, toMe(ctx.user));
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
