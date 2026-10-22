import assert from "node:assert/strict";
import test from "node:test";
import { chatSessionTitle, resolveUntitledSessionTitles } from "../src/entities/chat/lib/sessionTitle.ts";

test("첫 질문은 답변 완료 전부터 제목이 되고 후속 질문으로 바뀌지 않는다", () => {
  const messages = [
    { role: "assistant", content: "안녕하세요" },
    { role: "user", content: "  토양 수분 센서\n 운영 방법은?  ", status: "pending" },
    { role: "user", content: "관수 밸브는?" }
  ];
  for (const title of [null, "", "  ", "새 채팅", " 새 채팅 "]) {
    assert.equal(chatSessionTitle(title, messages), "토양 수분 센서 운영 방법은?");
  }
});

test("AI가 만든 제목이나 사용자가 지정한 제목은 첫 질문보다 우선한다", () => {
  assert.equal(chatSessionTitle("센서 운영 가이드", [{ role: "user", content: "질문" }]), "센서 운영 가이드");
});

test("빈 대화·공백 질문은 새 채팅으로 남고 첫 유효 질문을 찾는다", () => {
  assert.equal(chatSessionTitle(null), "새 채팅");
  assert.equal(chatSessionTitle(null, [{ role: "user", content: "  " }]), "새 채팅");
  assert.equal(chatSessionTitle(null, [{ role: "user", content: "  " }, { role: "user", content: "실제 질문" }]), "실제 질문");
});

test("긴 질문은 이모지를 깨뜨리지 않고 말줄임 포함 30자로 줄인다", () => {
  const result = chatSessionTitle(null, [{ role: "user", content: "🌱".repeat(40) }]);
  assert.equal(result, "🌱".repeat(29) + "…");
  assert.equal(Array.from(result).length, 30);
});

test("이전 기본 제목만 보완하고 서버 응답을 변경하거나 완성된 제목을 조회하지 않는다", async () => {
  const sessions = [{ id: "named", title: "사용자 제목" }, { id: "legacy", title: "새 채팅" }];
  const calls = [];
  const result = await resolveUntitledSessionTitles(sessions, async (id) => {
    calls.push(id);
    return { messages: [{ role: "user", content: "워크스페이스 권한 설정" }] };
  });
  assert.deepEqual(calls, ["legacy"]);
  assert.deepEqual(result.map(s => s.title), ["사용자 제목", "워크스페이스 권한 설정"]);
  assert.equal(sessions[1].title, "새 채팅");
});

test("목록 조회는 4개로 제한하며 한 세션 실패가 다른 제목을 막지 않는다", async () => {
  let active = 0;
  let peak = 0;
  const result = await resolveUntitledSessionTitles(
    Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: null })),
    async (id) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      if (id === "3") throw new Error("failed");
      return { messages: [{ role: "user", content: `질문 ${id}` }] };
    }
  );
  assert.equal(peak, 4);
  assert.equal(result[3].title, null);
  assert.equal(result[9].title, "질문 9");
});

test("목록을 닫으면 아직 시작하지 않은 메시지 조회를 보내지 않는다", async () => {
  let cancelled = false;
  let calls = 0;
  await resolveUntitledSessionTitles(
    Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: null })),
    async () => {
      calls++;
      cancelled = true;
      return { messages: [] };
    },
    () => cancelled
  );
  assert.equal(calls, 1);
});
