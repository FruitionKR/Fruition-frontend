import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

test("AI Markdown 저장은 multipart 전송 후에도 승인된 UTF-8 원문을 보존한다", async () => {
  const markdown = "<!-- fruition-note: doc-1 -->\n## 회의록\n\n- 담당자: \n- \n";
  const api = {
    getWorkspaceId: () => "ws-1",
    workspacePath: (...parts) => `/api/workspaces/${parts.join("/")}`,
    ERROR_MESSAGES: {},
    parseJsonOrThrow: (response) => response.json(),
    apiFetch: async (path, init) => {
      const request = new Request(`http://localhost${path}`, init);
      // FormData 객체가 아니라 실제 전송 형식으로 직렬화한 뒤 서버처럼 읽는다.
      const received = await new Response(await request.arrayBuffer(), {
        headers: { "Content-Type": request.headers.get("Content-Type") }
      }).formData();
      const part = received.get("markdown");
      const decoded = typeof part === "string" ? part : await part.text();
      assert.equal(decoded, markdown);
      assert.equal(received.get("base_revision"), "1");
      assert.equal(received.get("source"), "agent");
      assert.equal(received.get("apply_operation_id"), "op-1");
      return Response.json({ document_id: "doc-1", current_version: 2, updated_at: "now" });
    }
  };
  const source = readFileSync(new URL("../src/features/note-editing/api/note.ts", import.meta.url), "utf8");
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: () => api, FormData, Blob, crypto });
  const result = await exports.saveNoteDraft("doc-1", markdown, 1, "agent", "op-1");
  assert.equal(result.content_version, 2);
});
