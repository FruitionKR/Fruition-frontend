export const dynamic = "force-dynamic";

/**
 * 외부 AI 연결 안내가 보여 줄 MCP 서버 주소. document-svc와 같은 배포 값(MCP_RESOURCE_URI)만 쓰고,
 * 화면 주소에서 추측하지 않는다. 없거나 정규 HTTPS `/mcp` 주소가 아니면 null이다.
 */
export function GET() {
  let endpoint: string | null = null;
  try {
    const url = new URL(process.env.MCP_RESOURCE_URI ?? "");
    if (url.protocol === "https:" && url.pathname === "/mcp" && !url.search && !url.hash && !url.username && !url.password) endpoint = url.href;
  } catch {
    endpoint = null;
  }
  return Response.json({ endpoint }, { headers: { "Cache-Control": "no-store" } });
}
