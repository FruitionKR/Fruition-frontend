import assert from "node:assert/strict";
import test from "node:test";

const { taskAnswerBlocks } = await import("../src/features/agent-chat/lib/taskAnswer.ts");

test("답변을 빈 줄 단위 문단과 '- ' 목록으로 나눈다", () => {
  const message = "'회의록' 폴더(회의록)에 하위 폴더 1개, 문서 2개가 있어요.\n\n- 📁 2026 회의록\n- 10월 4주차 제품 회의\n- 킥오프\n\n문서 내용이 궁금하면 채팅 탭에서 질문해 주세요.";
  assert.deepEqual(taskAnswerBlocks(message), [
    { kind: "paragraph", text: "'회의록' 폴더(회의록)에 하위 폴더 1개, 문서 2개가 있어요." },
    { kind: "list", items: ["📁 2026 회의록", "10월 4주차 제품 회의", "킥오프"] },
    { kind: "paragraph", text: "문서 내용이 궁금하면 채팅 탭에서 질문해 주세요." }
  ]);
});

test("되묻기·못 찾음 안내도 같은 규칙으로 나누고, 문단 안 줄바꿈은 남긴다", () => {
  assert.deepEqual(taskAnswerBlocks("해당하는 폴더가 여러 개예요. 어느 폴더인지 경로를 적어 다시 요청해 주세요.\n\n- 회의록\n- 2026 / 회의록"), [
    { kind: "paragraph", text: "해당하는 폴더가 여러 개예요. 어느 폴더인지 경로를 적어 다시 요청해 주세요." },
    { kind: "list", items: ["회의록", "2026 / 회의록"] }
  ]);
  assert.deepEqual(taskAnswerBlocks("첫 줄\n둘째 줄\n- 항목"), [
    { kind: "paragraph", text: "첫 줄\n둘째 줄" },
    { kind: "list", items: ["항목"] }
  ]);
  assert.deepEqual(taskAnswerBlocks("  \n\n"), []);
});

test("HTML·Markdown 기호는 해석하지 않고 글자 그대로 둔다", () => {
  assert.deepEqual(taskAnswerBlocks("- <img src=x onerror=alert(1)>\n- **굵게** [링크](javascript:alert(1))"), [
    { kind: "list", items: ["<img src=x onerror=alert(1)>", "**굵게** [링크](javascript:alert(1))"] }
  ]);
});
