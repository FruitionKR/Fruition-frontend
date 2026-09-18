// 로컬 mock API 서버. access-svc(8081)와 document-svc(8080)를 하나의 라우터로 흉내 낸다.
// 실행: npm run mock (또는 npm run dev:mock으로 next dev와 함께)
import { createRouter, listen } from "./lib/http.mjs";
import { state } from "./state.mjs";
import { seed, DEMO_EMAIL, DEMO_PASSWORD } from "./seed.mjs";
import { scheduleSeedProcessing } from "./pipeline.mjs";
import { registerAuthRoutes } from "./routes/auth.mjs";
import { registerWorkspaceRoutes } from "./routes/workspaces.mjs";
import { registerDocumentRoutes } from "./routes/documents.mjs";
import { registerWikiRoutes } from "./routes/wiki.mjs";
import { registerChatRoutes } from "./routes/chat.mjs";
import { registerQueryRoutes } from "./routes/query.mjs";
import { registerAgentRoutes } from "./routes/agent.mjs";
import { registerCatalogRoutes } from "./routes/catalog.mjs";

const ACCESS_PORT = Number(process.env.MOCK_ACCESS_PORT ?? 8081);
const DOCUMENT_PORT = Number(process.env.MOCK_DOCUMENT_PORT ?? 8080);

seed();
scheduleSeedProcessing();

const router = createRouter(state);
// access-svc 담당 경로
registerAuthRoutes(router);
registerWorkspaceRoutes(router);
// document-svc 담당 경로. next.config rewrite가 경로별로 포트를 고르므로 두 포트 모두 같은 라우터를 쓴다.
registerDocumentRoutes(router);
registerWikiRoutes(router);
registerChatRoutes(router);
registerQueryRoutes(router);
registerAgentRoutes(router);
registerCatalogRoutes(router);

const servers = await Promise.all([listen(router, ACCESS_PORT), listen(router, DOCUMENT_PORT)]);

console.log(`[mock] access-svc  → http://localhost:${ACCESS_PORT}`);
console.log(`[mock] document-svc → http://localhost:${DOCUMENT_PORT}`);
console.log(`[mock] 데모 계정: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

function shutdown() {
  for (const server of servers) server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
