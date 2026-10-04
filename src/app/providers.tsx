"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserPreferencesProvider, useSessionExpiry } from "@/entities/user";

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
        <UserPreferencesProvider>{children}</UserPreferencesProvider>
      </SessionExpiryGate>
    </QueryClientProvider>
  );
}

/** useSignOut이 QueryClient를 쓰므로 Provider 안쪽에서 세션 만료 처리기를 등록한다. */
function SessionExpiryGate({ children }: { children: React.ReactNode }) {
  useSessionExpiry();
  return <>{children}</>;
}
