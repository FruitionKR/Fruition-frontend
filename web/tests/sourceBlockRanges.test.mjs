import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBlockText, resolveSourceBlockRanges } from "../src/entities/document/lib/sourceBlockRanges.ts";

const MARKDOWN = [
  "# 정렬",
  "",
  "삽입정렬 함정: i=3(key=6)처럼",
  "앞쪽 원소를 밀어낸다.",
  "",
  "## 레드블랙트리",
  "",
  "레드블랙트리의 균형 규칙은 느슨하다."
].join("\n");

function block(blockId, text, lineStart = null, lineEnd = lineStart) {
  return { block_id: blockId, position: null, line_start: lineStart, line_end: lineEnd, block_type: null, text };
}

test("스냅샷이 현재 본문과 같으면 서버 줄 범위와 영구 block ID를 그대로 쓴다", () => {
  // 영구 ID라 문서 순서와 번호가 다르다. 순번(B0004)으로 다시 매기면 안 된다.
  const response = {
    is_stale: false,
    blocks: [
      block("B0001", "# 정렬", 1),
      block("B0002", "삽입정렬 함정: i=3(key=6)처럼 앞쪽 원소를 밀어낸다.", 3, 4),
      block("B0439", "## 레드블랙트리", 6),
      block("B0440", "레드블랙트리의 균형 규칙은 느슨하다.", 8)
    ]
  };

  assert.deepEqual(resolveSourceBlockRanges(MARKDOWN, response, ["B0440"]), {
    ranges: [{ blockId: "B0440", startLine: 8, endLine: 8 }],
    missingBlockIds: []
  });
});

test("신뢰 범위는 텍스트를 다시 대조하지 않는다", () => {
  const response = { is_stale: false, blocks: [block("B0440", "본문과 다른 텍스트", 3, 4)] };

  assert.deepEqual(resolveSourceBlockRanges(MARKDOWN, response, ["B0440"]).ranges, [
    { blockId: "B0440", startLine: 3, endLine: 4 }
  ]);
});

test("문서가 수정되어 stale이면 정규화 텍스트로 현재 위치를 찾는다", () => {
  // 스냅샷에서는 3~4줄이었지만 현재 본문에서는 앞에 줄이 추가돼 밀렸다.
  const edited = ["# 새 머리말", "", MARKDOWN].join("\n");
  const response = {
    is_stale: true,
    blocks: [block("B0002", "삽입정렬 함정: i=3(key=6)처럼 앞쪽 원소를 밀어낸다.", 3, 4)]
  };

  assert.deepEqual(resolveSourceBlockRanges(edited, response, ["B0002"]), {
    ranges: [{ blockId: "B0002", startLine: 5, endLine: 6 }],
    missingBlockIds: []
  });
});

test("is_stale이 null이거나 구 응답이라 필드가 없으면 텍스트로 찾는다", () => {
  const legacy = { blocks: [{ block_id: "B0440", text: "레드블랙트리의 균형 규칙은 느슨하다." }] };
  const unknown = { is_stale: null, blocks: [block("B0440", "레드블랙트리의 균형 규칙은 느슨하다.", 1)] };

  for (const response of [legacy, unknown]) {
    assert.deepEqual(resolveSourceBlockRanges(MARKDOWN, response, ["B0440"]).ranges, [
      { blockId: "B0440", startLine: 8, endLine: 8 }
    ]);
  }
});

test("서버 범위가 없거나 현재 줄 수를 넘으면 텍스트로 찾는다", () => {
  const response = {
    is_stale: false,
    blocks: [
      block("session_1:pair_1", "## 레드블랙트리"),
      block("B0440", "레드블랙트리의 균형 규칙은 느슨하다.", 20, 21)
    ]
  };

  assert.deepEqual(resolveSourceBlockRanges(MARKDOWN, response, ["session_1:pair_1", "B0440"]).ranges, [
    { blockId: "session_1:pair_1", startLine: 6, endLine: 6 },
    { blockId: "B0440", startLine: 8, endLine: 8 }
  ]);
});

test("같은 텍스트가 여러 곳이면 서버 줄 힌트에 가까운 위치를 고른다", () => {
  const markdown = ["## 예시", "", "첫 설명", "", "## 예시", "", "둘째 설명"].join("\n");

  const withHint = { is_stale: true, blocks: [block("B0009", "## 예시", 4)] };
  const withoutHint = { is_stale: true, blocks: [block("B0009", "## 예시")] };

  assert.equal(resolveSourceBlockRanges(markdown, withHint, ["B0009"]).ranges[0].startLine, 5);
  assert.equal(resolveSourceBlockRanges(markdown, withoutHint, ["B0009"]).ranges[0].startLine, 1);
});

test("줄 중간에서 시작하거나 끝나는 부분 일치는 근거 위치로 보지 않는다", () => {
  const markdown = ["Lint와 Ingest를 비교한다.", "", "Lint"].join("\n");
  const response = { is_stale: true, blocks: [block("B0003", "Ingest"), block("B0004", "Lint")] };

  assert.deepEqual(resolveSourceBlockRanges(markdown, response, ["B0003", "B0004"]), {
    ranges: [{ blockId: "B0004", startLine: 3, endLine: 3 }],
    missingBlockIds: ["B0003"]
  });
});

test("목록에 없는 block과 본문에서 사라진 block은 위치를 찾지 못한 것으로 돌려준다", () => {
  const response = { is_stale: true, blocks: [block("B0005", "삭제된 문단", 3)] };

  assert.deepEqual(resolveSourceBlockRanges(MARKDOWN, response, ["B0005", "B9999", "B0005"]), {
    ranges: [],
    missingBlockIds: ["B0005", "B9999"]
  });
});

test("CRLF·들여쓰기·여러 공백이 섞여도 서버 정규화 텍스트와 맞춘다", () => {
  const markdown = "# 제목\r\n\r\n  첫 줄   이어서\r\n둘째\t줄\r\n";
  const response = { is_stale: true, blocks: [block("B0002", "첫 줄 이어서 둘째 줄")] };

  assert.equal(normalizeBlockText("  첫 줄\r\n  이어서 "), "첫 줄 이어서");
  assert.deepEqual(resolveSourceBlockRanges(markdown, response, ["B0002"]).ranges, [
    { blockId: "B0002", startLine: 3, endLine: 4 }
  ]);
});

test("공백 판정은 서버(Python str.isspace)와 같고 JS \\s와 다른 글자도 맞춘다", () => {
  // Python에서만 공백: U+001C~U+001F, U+0085. JS \s에서만 공백: U+FEFF.
  assert.equal(normalizeBlockText("가\u001c\u001f나\u0085다"), "가 나 다");
  assert.equal(normalizeBlockText("﻿가﻿나﻿"), "﻿가﻿나﻿");
  assert.equal(normalizeBlockText("\u0085 가 \u001d"), "가");

  const markdown = ["# 제목", "", "가\u001c나", "﻿다"].join("\n");
  const response = {
    is_stale: true,
    blocks: [block("B0002", "가 나"), block("B0003", "﻿다")]
  };
  assert.deepEqual(resolveSourceBlockRanges(markdown, response, ["B0002", "B0003"]), {
    ranges: [
      { blockId: "B0002", startLine: 3, endLine: 3 },
      { blockId: "B0003", startLine: 4, endLine: 4 }
    ],
    missingBlockIds: []
  });
});
