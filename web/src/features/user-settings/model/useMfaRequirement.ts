import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMfaStatus, MFA_QUERY_KEY } from "@/entities/user";

/**
 * 본인 확인 창에서 MFA 인증 코드 칸을 보일지 정한다. 기본은 GET /api/auth/me/mfa의 enabled다.
 * 조회가 실패했거나 창을 연 뒤 다른 탭에서 MFA를 켜 캐시가 낡으면 칸이 숨은 채 401 INVALID_MFA_CODE만 반복된다.
 * 그래서 서버가 INVALID_MFA_CODE로 거절하면 requireMfa()로 칸을 강제로 보이고 MFA 상태를 다시 읽는다.
 */
export function useMfaRequirement() {
  const queryClient = useQueryClient();
  const { data: mfaStatus } = useQuery({ queryKey: MFA_QUERY_KEY, queryFn: fetchMfaStatus, retry: false });
  const [isRequiredByServer, setIsRequiredByServer] = useState(false);

  function requireMfa() {
    setIsRequiredByServer(true);
    void queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
  }

  return { isMfaEnabled: isRequiredByServer || mfaStatus?.enabled === true, requireMfa };
}
