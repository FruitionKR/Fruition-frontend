// 의존성 없는 최소 HTTP 라우터. 경로 패턴(:param) 매칭, 본문 파싱, JSON/SSE 응답 헬퍼를 제공한다.
import http from "node:http";

const TOKEN_TTL_MS = 30 * 60_000;

export function createRouter(state) {
  const routes = [];

  function add(method, pattern, handler, options = {}) {
    const keys = [];
    const source = pattern.replace(/:([a-zA-Z]+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, open: Boolean(options.open) });
  }

  const api = {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    put: (p, h, o) => add("PUT", p, h, o),
    patch: (p, h, o) => add("PATCH", p, h, o),
    delete: (p, h, o) => add("DELETE", p, h, o),
    async handle(req, res, port) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const ctx = createContext(req, res, url, state, port);
      try {
        for (const route of routes) {
          if (route.method !== req.method) continue;
          const match = url.pathname.match(route.regex);
          if (!match) continue;
          route.keys.forEach((key, index) => { ctx.params[key] = decodeURIComponent(match[index + 1]); });
          if (!route.open && !authenticate(ctx)) return;
          await route.handler(ctx);
          if (!res.writableEnded && !ctx.streaming) ctx.json(200, {});
          return;
        }
        const message = `mock: unhandled ${req.method} ${url.pathname}`;
        console.log(`[mock:${port}] !! ${message}`);
        ctx.json(404, { error: { message } });
      } catch (error) {
        console.error(`[mock:${port}] error on ${req.method} ${url.pathname}`, error);
        if (!res.writableEnded) ctx.json(500, { error: { message: `mock: ${error.message}` } });
      }
    }
  };
  return api;
}

function authenticate(ctx) {
  const header = ctx.req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const session = token ? ctx.state.tokens.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    ctx.json(401, { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } });
    return false;
  }
  ctx.user = ctx.state.users.find((user) => user.id === session.userId) ?? null;
  if (!ctx.user) {
    ctx.json(401, { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } });
    return false;
  }
  return true;
}

export function issueAccessToken(state, userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const token = `mock.${payload}.${crypto.randomUUID().slice(0, 8)}`;
  state.tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function createContext(req, res, url, state, port) {
  let rawPromise = null;
  const ctx = {
    req, res, url, state, port,
    params: {},
    query: url.searchParams,
    user: null,
    streaming: false,
    cookies: parseCookies(req.headers.cookie),
    status: null,
    raw() {
      if (!rawPromise) {
        rawPromise = new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
      }
      return rawPromise;
    },
    async body() {
      const buffer = await ctx.raw();
      const type = req.headers["content-type"] ?? "";
      if (buffer.length === 0) return {};
      if (type.includes("application/json")) return JSON.parse(buffer.toString("utf8"));
      if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
        const form = await new Response(buffer, { headers: { "content-type": type } }).formData();
        const result = {};
        for (const [key, value] of form.entries()) {
          result[key] = typeof value === "string"
            ? value
            : { name: value.name, type: value.type, buffer: Buffer.from(await value.arrayBuffer()) };
        }
        return result;
      }
      return { text: buffer.toString("utf8") };
    },
    json(status, data, headers = {}) {
      ctx.status = status;
      const body = status === 204 ? "" : JSON.stringify(data);
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
      res.end(body);
      log(ctx);
    },
    bytes(status, buffer, contentType) {
      ctx.status = status;
      res.writeHead(status, { "Content-Type": contentType, "Content-Length": buffer.length });
      res.end(buffer);
      log(ctx);
    },
    redirect(location) {
      ctx.status = 302;
      res.writeHead(302, { Location: location });
      res.end();
      log(ctx);
    },
    setCookie(name, value, maxAgeSeconds) {
      const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
      res.setHeader("Set-Cookie", parts.join("; "));
    },
    /** SSE 스트림을 연다. 반환된 send(event, data)/close()로 프레임을 보낸다. */
    sse() {
      ctx.streaming = true;
      ctx.status = 200;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      log(ctx);
      return {
        send(event, data) {
          if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
        close() { if (!res.writableEnded) res.end(); },
        closed: () => res.writableEnded || res.destroyed
      };
    }
  };
  return ctx;
}

function log(ctx) {
  console.log(`[mock:${ctx.port}] ${ctx.req.method} ${ctx.url.pathname}${ctx.url.search} → ${ctx.status}`);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

export function listen(router, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { void router.handle(req, res, port); });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}
