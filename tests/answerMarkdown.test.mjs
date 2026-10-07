import assert from "node:assert/strict";
import test from "node:test";
import { formatAnswerMarkdown } from "../src/features/agent-chat/lib/agentFormatters.ts";

test("리스트 항목의 citation은 같은 항목 문장 끝에 남는다", () => {
  const input = "- 문서는 S3에 저장됩니다. [1]\n- 메타데이터는 DB가 관리합니다. [2]";

  assert.equal(formatAnswerMarkdown(input), input);
});

test("리스트 항목 안의 두 번째 문장도 항목 밖으로 나누지 않는다", () => {
  const input = "- 첫 문장입니다. 두 번째 문장입니다. [1]";

  assert.equal(formatAnswerMarkdown(input), input);
});

test("일반 문단은 문장별로 나누고 citation은 자기 문장 끝에 붙인다", () => {
  assert.equal(
    formatAnswerMarkdown("첫 문장입니다. [1] 두 번째 문장입니다. [2]"),
    "첫 문장입니다. [1]\n\n두 번째 문장입니다. [2]"
  );
});

test("여러 번호 citation 묶음도 앞 문장에 붙인다", () => {
  assert.equal(
    formatAnswerMarkdown("첫 문장입니다. [1, 2] 두 번째입니다. [1][2] 세 번째입니다."),
    "첫 문장입니다. [1, 2]\n\n두 번째입니다. [1][2]\n\n세 번째입니다."
  );
});

test("citation이 없는 문장은 기존처럼 빈 줄로 나눈다", () => {
  assert.equal(formatAnswerMarkdown("첫 문장. 두 번째 문장."), "첫 문장.\n\n두 번째 문장.");
  assert.equal(formatAnswerMarkdown("첫 문장.\n두 번째 문장."), "첫 문장.\n\n두 번째 문장.");
});

test("소수점과 순서 목록 마침표는 나누지 않는다", () => {
  assert.equal(formatAnswerMarkdown("버전 3.5 기준입니다"), "버전 3.5 기준입니다");
  const ordered = "1. 첫 단계입니다. [1]\n2. 둘째 단계입니다.";
  assert.equal(formatAnswerMarkdown(ordered), ordered);
});

test("제목·인용·표 줄은 나누지 않는다", () => {
  const input = "## 개요. 설명\n> 인용 문장. 다음 문장.\n| a. b | c. d |";

  assert.equal(formatAnswerMarkdown(input), input);
});

test("코드 펜스 안의 마침표는 나누지 않는다", () => {
  const input = "예시입니다.\n\n```ts\nconst a = foo. bar;\nfoo. bar\n```\n\n끝입니다. 정말로.";

  assert.equal(
    formatAnswerMarkdown(input),
    "예시입니다.\n\n```ts\nconst a = foo. bar;\nfoo. bar\n```\n\n끝입니다.\n\n정말로."
  );
});

test("내부 블록 참조는 제거하고 숫자 citation은 유지한다", () => {
  assert.equal(
    formatAnswerMarkdown("문장입니다 [doc:B0001]. [1] 다음입니다."),
    "문장입니다. [1]\n\n다음입니다."
  );
});
