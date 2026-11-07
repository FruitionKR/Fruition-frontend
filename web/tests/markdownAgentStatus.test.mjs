import assert from "node:assert/strict";
import test from "node:test";
import * as statusSteps from "../src/features/agent-chat/lib/statusSteps.ts";
import { useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const buildStatusSteps = (...args) => statusSteps.buildStatusSteps(...args, agentChatT);
const buildDocumentCommandSteps = (...args) => statusSteps.buildDocumentCommandSteps(...args, agentChatT);
const messageStatusTitle = (status) => statusSteps.messageStatusTitle(status, agentChatT);

test("일반 Query는 Wiki 검색과 근거 답변 단계를 유지한다", () => {
  assert.deepEqual(buildStatusSteps(false, true), [
    ["질문 분석", "done"],
    ["관련 Wiki page 검색", "done"],
    ["근거 기반 답변 작성", "done"]
  ]);
});

test("문서 편집 명령은 LLM 생성과 편집 단계를 표시한다", () => {
  assert.deepEqual(buildDocumentCommandSteps("markdown_edit", false, true), [
    ["질문 분석", "done"],
    ["LLM 답변 생성", "done"],
    ["문서 편집", "done"]
  ]);
});

test("새 문서 명령은 마지막 단계를 생성으로 구분한다", () => {
  assert.deepEqual(buildDocumentCommandSteps("markdown_create", true, false), [
    ["질문 분석", "done"],
    ["LLM 답변 생성", "active"],
    ["새 문서 생성", "pending"]
  ]);
});

test("말풍선 상태 제목은 진행·완료·취소를 구분하고 그 밖의 종료는 '요청 처리 종료'로 둔다", () => {
  assert.equal(messageStatusTitle("pending"), "요청 처리 중");
  assert.equal(messageStatusTitle("completed"), "요청 처리 완료");
  assert.equal(messageStatusTitle("cancelled"), "요청 취소됨");
  assert.equal(messageStatusTitle("failed"), "요청 처리 종료");
});
