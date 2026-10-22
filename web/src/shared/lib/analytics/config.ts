/** 브라우저 HTML과 CSP에는 활성화된 공개 수집 키만 전달한다. */
export function publicAnalyticsToken(enabled: string | undefined, token: string | undefined): string {
  return enabled === "true" && token && token === token.trim() && /^phc_[A-Za-z0-9_-]+$/.test(token) ? token : "";
}
