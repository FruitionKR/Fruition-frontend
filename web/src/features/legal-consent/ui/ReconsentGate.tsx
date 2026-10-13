"use client";

import { useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildConsentBody,
  consentErrorMessage,
  EMPTY_CONSENT,
  isConsentComplete,
  ME_QUERY_KEY,
  needsReconsent,
  submitConsents,
  useMe,
  useSignOut,
  type ConsentChoices,
  type UserMeResponse
} from "@/entities/user";
import { LEGAL_TERMS_VERSION } from "@/shared/config/legal";
import { isPublicAuthPath } from "@/shared/lib/authSessionStorage";
import { AuthError, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";
import { ConsentForm } from "./ConsentForm";

/**
 * 이용약관이 바뀐 기존 회원(consent_required)의 재동의를 앱 전체에서 한 번 받는다.
 * 로그인·가입 화면에는 세션이 없으므로 묻지 않고, 보호된 화면에서 /me가 재동의를 요구할 때만 덮어 보여 준다.
 */
export function ReconsentGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isProtectedScreen = !isPublicAuthPath(pathname);
  const { data: me } = useMe({ enabled: isProtectedScreen });

  return (
    <>
      {children}
      {isProtectedScreen && needsReconsent(me) && <ReconsentScreen />}
    </>
  );
}

function ReconsentScreen() {
  const queryClient = useQueryClient();
  const { signOut } = useSignOut();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = buildConsentBody(choices, LEGAL_TERMS_VERSION);
    if (busy || !body) return;
    setBusy(true);
    setError(null);
    try {
      await submitConsents(body);
      // 서버가 동의를 기록했으니 /me를 다시 묻지 않고 캐시만 고쳐 화면을 바로 돌려준다.
      queryClient.setQueryData<UserMeResponse>(ME_QUERY_KEY, (current) =>
        current ? { ...current, consent_required: false } : current
      );
    } catch (cause: unknown) {
      setError(consentErrorMessage(cause, "약관 동의를 저장하지 못했습니다."));
      setBusy(false);
    }
  }

  return (
    <div className="auth-consent-overlay auth-screen auth-screen--login" role="dialog" aria-modal="true" aria-labelledby="reconsent-title">
      <section className="auth-shell auth-shell--verification">
        <div className="auth-content">
          <h1 className="auth-title" id="reconsent-title">약관 동의</h1>
          <div className="auth-main-section">
            <p className="auth-prompt auth-prompt--wrap">이용약관이 바뀌었습니다. 계속 이용하려면 아래 항목에 다시 동의해 주세요.</p>
            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              <div className="auth-field-with-error">
                <ConsentForm disabled={busy} idPrefix="reconsent" onChange={setChoices} value={choices} />
                {error ? <AuthError>{error}</AuthError> : null}
              </div>
              <AuthSubmitButton disabled={busy || !isConsentComplete(choices)}>{busy ? "저장 중…" : "동의하고 계속"}</AuthSubmitButton>
            </form>
            <p className="auth-prompt">동의하지 않으시겠어요?<button disabled={busy} onClick={() => void signOut({ callLogout: true })} type="button">로그아웃</button></p>
          </div>
        </div>
      </section>
    </div>
  );
}
