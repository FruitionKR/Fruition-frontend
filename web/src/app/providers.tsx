"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountLocaleSync, SessionExpiryGate, UserPreferencesProvider } from "@/entities/user";
import { ReconsentGate } from "@/features/legal-consent";
import { LEGAL_PAGES_ENABLED } from "@/shared/config/legal";
import { AnalyticsProvider } from "./AnalyticsProvider";
import type { AnalyticsConfig } from "@/shared/lib/analytics/client";

export function Providers({ children, analytics }: { children: React.ReactNode; analytics: AnalyticsConfig }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* 계정에 저장한 화면 언어와 이 브라우저의 언어 쿠키를 맞춘다. */}
      <AccountLocaleSync />
      <AnalyticsProvider config={analytics}>
      <SessionExpiryGate>
        <UserPreferencesProvider>
          {/* 약관 공개 플래그가 꺼져 있으면 재동의를 묻지 않는다(서버도 consent_required=false). */}
          {LEGAL_PAGES_ENABLED ? <ReconsentGate>{children}</ReconsentGate> : children}
        </UserPreferencesProvider>
      </SessionExpiryGate>
      </AnalyticsProvider>
    </QueryClientProvider>
  );
}
