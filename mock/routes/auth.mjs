// access-svc(8081) 인증 라우트: 로그인·회원가입·토큰 재발급·MFA·계정 설정·세션.
import { randomUUID } from "node:crypto";
import { issueAccessToken } from "../lib/http.mjs";
import { state, now, id, error } from "../state.mjs";

const REFRESH_COOKIE = "refresh";
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 14;
const VERIFICATION_TTL_SECONDS = 300;

function toMe(user) {
  return { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at };
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
  return { access_token: issueAccessToken(state, user.id), mfa_required: false };
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
  router.get("/oauth2/authorization/:provider", (ctx) => {
    ctx.redirect(`http://localhost:3000/login?code=mock-${ctx.params.provider}`);
  }, { open: true });

  router.post("/api/auth/oauth/exchange", async (ctx) => {
    const { code } = await ctx.body();
    if (typeof code !== "string" || !code.startsWith("mock-")) return error(ctx, 400, "OAuth 코드가 올바르지 않습니다.");
    const user = state.users[0];
    issueTokensOrMfa(ctx, user);
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
    const available = !state.users.some((user) => user.email === String(email ?? "").toLowerCase());
    ctx.json(200, { available });
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
    const { email, password, display_name, verification_token } = await ctx.body();
    if (!state.verificationTokens.has(verification_token)) return error(ctx, 400, "이메일 인증이 필요합니다.");
    const normalized = String(email ?? "").toLowerCase();
    if (state.users.some((user) => user.email === normalized)) return error(ctx, 409, "이미 가입된 이메일입니다.");
    state.verificationTokens.delete(verification_token);
    state.users.push({ id: id("user"), email: normalized, password, display_name: display_name || null, provider: "email", created_at: now(), mfa: { enabled: false, activated_at: null, secret: null, recovery_codes: [] } });
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
