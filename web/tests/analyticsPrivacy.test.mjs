import assert from "node:assert/strict";
import test from "node:test";
import { analyticsLocation, sanitizeAnalyticsEvent } from "../src/shared/lib/analytics/sanitize.ts";
import { analyticsEditType } from "../src/shared/lib/analytics/events.ts";
import { buildContentSecurityPolicy } from "../src/shared/lib/security/contentSecurityPolicy.ts";

test("초대 경로·인증 쿼리·문서 ID·알 수 없는 경로를 수집 URL에 남기지 않는다", () => {
  const cases = [
    ["/invitations/secret-token?email=private#fragment", "/invitations/:token"],
    ["/oauth/callback?code=secret", "/oauth/callback"],
    ["/reset-password?token=secret", "/reset-password"],
    ["/signup/verify?token=secret", "/signup/verify"],
    ["/home?doc=private-document&page=private-page&tree=private-tree", "/home"],
    ["/unknown/private-title", "/:route"],
  ];
  for (const [raw, path] of cases) {
    const clean = analyticsLocation(`https://app.example.com${raw}`);
    assert.equal(clean.$pathname, path);
    assert.equal(clean.$current_url, `https://app.example.com${path}`);
    assert.doesNotMatch(JSON.stringify(clean), /secret|private/);
  }
});

test("SDK 자동 속성과 호출자 임의 속성에 섞인 개인정보를 최종 전송에서 제거한다", () => {
  const result = sanitizeAnalyticsEvent({ event: "citation_opened", $set_once: { $initial_current_url: "https://app.example.com/invitations/secret" }, $set: { email: "private@example.com" }, properties: {
    query_id: "query_123", rank: 1, citation_type: "internal", document_id: "doc_123",
    event_id: "event_123", environment: "staging", schema_version: 1, token: "phc_public_test",
    email: "private@example.com", title: "비공개 문서", question: "비공개 질문", answer: "비공개 답변",
    error: "private error", $current_url: "https://app.example.com/invitations/secret",
    $referrer: "https://app.example.com/reset-password?token=secret",
    $set: { email: "private@example.com" }, $set_once: { $initial_current_url: "secret" },
  } });
  assert.deepEqual(result.properties, {
    query_id: "query_123", rank: 1, citation_type: "internal", document_id: "doc_123",
    event_id: "event_123", environment: "staging", schema_version: 1, token: "phc_public_test",
  });
  assert.equal(result.$set, undefined);
  assert.equal(result.$set_once, undefined);
});

test("명세 밖 자동 이벤트·오류 수집·리플레이 스냅샷을 전송하지 않는다", () => {
  for (const event of ["$autocapture", "$exception", "$snapshot", "arbitrary_event"]) {
    assert.equal(sanitizeAnalyticsEvent({ event, properties: { text: "private" } }), null);
  }
});

test("페이지뷰는 명시한 화면 분류만 남기고 URL을 다시 정리한다", () => {
  const result = sanitizeAnalyticsEvent({ event: "$pageview", properties: {
    $current_url: "https://app.example.com/home?view=graph&doc=private#secret", $pathname: "/home?token=secret", $screen: "private-title",
  } });
  assert.deepEqual(result.properties, { $current_url: "https://app.example.com/home", $pathname: "/home", $screen: "graph" });
  assert.deepEqual(sanitizeAnalyticsEvent(result), result);
  assert.equal(sanitizeAnalyticsEvent({ event: "$pageview", properties: {
    $current_url: "https://app.example.com/home?view=private-title", $screen: "private-title",
  } }).properties.$screen, undefined);
});

test("편집 제안과 결정에 같은 편집 유형 매핑을 쓴다", () => {
  assert.equal(analyticsEditType({ operation: "insert_after", requested_target: { type: "whole_document" } }), "append");
  assert.equal(analyticsEditType({ operation: "replace", requested_target: { type: "whole_document" } }), "rewrite");
  assert.equal(analyticsEditType({ operation: "replace", requested_target: { type: "selection" } }), "replace");
  assert.equal(analyticsEditType(null), "other");
});

test("CSP는 수집이 켜졌을 때만 PostHog 수집·설정 도메인을 허용한다", () => {
  assert.doesNotMatch(buildContentSecurityPolicy({ nonce: "test" }), /posthog/);
  const policy = buildContentSecurityPolicy({ nonce: "test", analyticsEnabled: true });
  assert.match(policy, /https:\/\/us\.i\.posthog\.com/);
  assert.match(policy, /https:\/\/us-assets\.i\.posthog\.com/);
  assert.doesNotMatch(policy, /https:\/\/\*\.posthog\.com/);
});
