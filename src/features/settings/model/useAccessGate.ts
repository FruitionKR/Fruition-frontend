"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAccessGateStatus, submitAccessCode } from "@/shared/api/accessGate";

export const ACCESS_GATE_QUERY_KEY = ["access-gate"] as const;

// isLocked: 게이트가 켜져 있고 아직 코드를 입력하지 않은 상태. 상태 조회 전에는 잠그지 않는다.
export function useAccessGate() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ACCESS_GATE_QUERY_KEY, queryFn: fetchAccessGateStatus, staleTime: Infinity });
  const isLocked = data ? data.enabled && !data.unlocked : false;
  const isEnabled = data?.enabled ?? false;

  async function unlock(code: string): Promise<boolean> {
    const ok = await submitAccessCode(code);
    if (ok) await queryClient.invalidateQueries({ queryKey: ACCESS_GATE_QUERY_KEY });
    return ok;
  }

  return { isEnabled, isLocked, unlock };
}
