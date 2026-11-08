import assert from "node:assert/strict";
import test from "node:test";

const { GET } = await import("../app/api/mcp-endpoint/route.ts");

async function endpointFor(value) {
  if (value === undefined) delete process.env.MCP_RESOURCE_URI; else process.env.MCP_RESOURCE_URI = value;
  return (await GET().json()).endpoint;
}

test("안내 주소는 서버 설정의 정규 HTTPS /mcp 주소만 내보내고 나머지는 null이다", async () => {
  assert.equal(await endpointFor("https://doc.example/mcp"), "https://doc.example/mcp");
  for (const bad of [undefined, "", "http://doc.example/mcp", "https://doc.example/other", "https://u:p@doc.example/mcp", "https://doc.example/mcp?x=1"]) {
    assert.equal(await endpointFor(bad), null, String(bad));
  }
});
