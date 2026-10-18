"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionExpiryGate, UserPreferencesProvider } from "@/entities/user";
import { ReconsentGate } from "@/features/legal-consent";
import { LEGAL_PAGES_ENABLED } from "@/shared/config/legal";

export function Providers({ children }: { children: React.ReactNode }) {
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
      <SessionExpiryGate>
        <UserPreferencesProvider>
          {/* 약관 공개 플래그가 꺼져 있으면 재동의를 묻지 않는다(서버도 consent_required=false). */}
          {LEGAL_PAGES_ENABLED ? <ReconsentGate>{children}</ReconsentGate> : children}
        </UserPreferencesProvider>
      </SessionExpiryGate>
    </QueryClientProvider>
  );
}
