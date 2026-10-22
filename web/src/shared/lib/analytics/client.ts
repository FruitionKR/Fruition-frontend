import type { PostHog } from "posthog-js";
import type { AnalyticsEvents } from "./events";
import { newAnalyticsId } from "@/shared/lib/analytics/events";
import { analyticsLocation, sanitizeAnalyticsEvent } from "@/shared/lib/analytics/sanitize";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

export type AnalyticsConfig = { token: string; environment: "local" | "staging" | "production"; appVersion: string; nonce?: string };
let client: PostHog | null = null;
let config: AnalyticsConfig | null = null;
let workspaceId: string | null = null;
let userId: string | null = null;
let initialization: Promise<void> | null = null;
let resetBeforeInitialization = false;
type PendingEvent = { event: keyof AnalyticsEvents; properties: Record<string, unknown>; timestamp: Date };
const pending: PendingEvent[] = [];

export function initializeAnalytics(options: AnalyticsConfig): Promise<void> {
  if (!options.token.startsWith("phc_")) return Promise.resolve();
  if (initialization) return initialization;
  config = options;
  initialization = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(options.token, {
      api_host: "https://us.i.posthog.com",
      defaults: "2026-08-30",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      disable_session_recording: true,
      person_profiles: "identified_only",
      mask_all_text: true,
      mask_all_element_attributes: true,
      property_denylist: ["$referrer", "$initial_referrer", "$referring_domain", "$initial_referring_domain"],
      before_send: sanitizeAnalyticsEvent,
      prepare_external_dependency_script: (script) => { if (options.nonce) script.nonce = options.nonce; return script; },
    });
    if (resetBeforeInitialization) {
      posthog.reset();
      resetBeforeInitialization = false;
    }
    client = posthog;
  }).catch(() => { initialization = null; });
  return initialization;
}

function common() {
  return { event_id: newAnalyticsId(), event_source: "frontend", environment: config?.environment, schema_version: 1, app_version: config?.appVersion, ...(workspaceId ? { workspace_id: workspaceId } : {}) };
}

/** 분석이 차단·실패해도 제품 동작에 영향을 주지 않는다. */
export function captureAnalytics<K extends keyof AnalyticsEvents>(event: K, properties: AnalyticsEvents[K], targetWorkspaceId?: string | null): void {
  try {
    const target = targetWorkspaceId ?? workspaceId ?? getSelectedWorkspaceId();
    const payload = { ...common(), ...properties, ...(target ? { workspace_id: target, $groups: { workspace: target } } : {}) };
    const timestamp = new Date();
    if (!client || !userId) {
      // 자식 화면의 첫 effect가 SDK·사용자 식별보다 먼저 실행돼도 최초 열림을 잃지 않는다.
      // 로그아웃 때 전부 버리고, 토큰이 없는 환경에서도 메모리는 50건으로 제한한다.
      if (pending.length >= 50) pending.shift();
      pending.push({ event, properties: payload, timestamp });
      return;
    }
    client.capture(event, payload, { timestamp });
  } catch { /* 분석 실패는 제품 실패가 아니다. */ }
}

export function capturePageview(url: string): void {
  try { client?.capture("$pageview", { ...common(), ...analyticsLocation(url) }); } catch { /* 차단기 등 */ }
}

export function identifyAnalytics(id: string): void {
  try {
    if (!client || userId === id) return;
    if (userId && userId !== id) client.reset();
    client.identify(id);
    userId = id;
    if (workspaceId) client.group("workspace", workspaceId);
    for (const item of pending.splice(0)) {
      client.capture(item.event, {
        ...item.properties,
        environment: config?.environment,
        app_version: config?.appVersion,
      }, { timestamp: item.timestamp });
    }
  } catch { /* 제품 인증과 독립 */ }
}

export function setAnalyticsWorkspace(id: string | null): void {
  workspaceId = id;
  try {
    client?.resetGroups();
    if (id && userId) client?.group("workspace", id);
  } catch { /* 워크스페이스 전환과 독립 */ }
}
export function resetAnalytics(): void {
  userId = null;
  workspaceId = null;
  pending.length = 0;
  if (!client) resetBeforeInitialization = true;
  try { client?.reset(); } catch { /* 제품 로그아웃과 독립 */ }
}

export function analyticsSessionHeaders(): Record<string, string> {
  try {
    const id = userId ? client?.get_session_id() : null;
    return id ? { "X-PostHog-Session-Id": id } : {};
  } catch { return {}; }
}
