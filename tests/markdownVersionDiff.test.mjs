import assert from "node:assert/strict";
import test from "node:test";
import { flattenDiffHunks } from "../src/features/document-history/lib/versionDiff.ts";

test("서버 diff hunk를 렌더링 행으로 평탄화한다", () => {
  const rows = flattenDiffHunks([
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [
        { type: "CONTEXT", old_line: 1, new_line: 1, content: "# 제목" },
        { type: "DELETE", old_line: 2, new_line: null, content: "이전 본문" },
        { type: "ADD", old_line: null, new_line: 2, content: "새 본문" }
      ]
    }
  ]);

  assert.deepEqual(rows, [
    { type: "context", text: "# 제목" },
    { type: "delete", text: "이전 본문" },
    { type: "insert", text: "새 본문" }
  ]);
});

test("hunk가 여러 개면 사이에 생략(gap) 행을 넣는다", () => {
  const hunk = (content) => ({
    old_start: 1,
    old_lines: 1,
    new_start: 1,
    new_lines: 1,
    lines: [{ type: "ADD", old_line: null, new_line: 1, content }]
  });

  const rows = flattenDiffHunks([hunk("첫 hunk"), hunk("둘째 hunk")]);

  assert.deepEqual(rows, [
    { type: "insert", text: "첫 hunk" },
    { type: "gap", text: "⋯" },
    { type: "insert", text: "둘째 hunk" }
  ]);
});

test("hunk가 없으면 빈 목록을 반환한다", () => {
  assert.deepEqual(flattenDiffHunks([]), []);
});

test("첫 줄 식별 주석만 숨기고 본문 예제와 일반 주석은 보존한다", () => {
  const lines = [
    { type: "DELETE", old_line: 1, new_line: null, content: "<!-- fruition-note: old -->" },
    { type: "ADD", old_line: null, new_line: 1, content: "<!-- fruition-workspace: new -->" },
    { type: "CONTEXT", old_line: 2, new_line: 2, content: "<!-- 일반 주석 -->" },
    { type: "ADD", old_line: null, new_line: 3, content: "<!-- fruition-note: example -->" },
    { type: "DELETE", old_line: 3, new_line: null, content: "# 이전" },
    { type: "ADD", old_line: null, new_line: 4, content: "# 현재" }
  ];
  const hunk = (lines) => ({ old_start: 1, old_lines: 3, new_start: 1, new_lines: 4, lines });
  assert.deepEqual(flattenDiffHunks([hunk(lines)]), [
    { type: "context", text: "<!-- 일반 주석 -->" },
    { type: "insert", text: "<!-- fruition-note: example -->" },
    { type: "delete", text: "# 이전" },
    { type: "insert", text: "# 현재" }
  ]);
  assert.deepEqual(flattenDiffHunks([hunk(lines.slice(0, 2))]), []);
  assert.deepEqual(flattenDiffHunks([hunk(lines.slice(0, 2)), hunk(lines.slice(4))]), [
    { type: "delete", text: "# 이전" },
    { type: "insert", text: "# 현재" }
  ]);
});
