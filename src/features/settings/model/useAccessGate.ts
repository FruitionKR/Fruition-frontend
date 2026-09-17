"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export const ACCESS_GATE_QUERY_KEY = ["access-gate"] as const;

type AccessGateStatus = { enabled: boolean; unlocked: boolean };

async function fetchAccessGateStatus(): Promise<AccessGateStatus> {
  const response = await fetch("/access/verify", { cache: "no-store" });
  if (!response.ok) throw new Error("접근 코드 상태를 확인하지 못했습니다.");
  return response.json() as Promise<AccessGateStatus>;
}

export async function submitAccessCode(code: string): Promise<boolean> {
  const response = await fetch("/access/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  return response.ok;
}

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
