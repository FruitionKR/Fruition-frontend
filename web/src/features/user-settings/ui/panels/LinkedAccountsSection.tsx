"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import {
  getOAuthLinkAuthorizationUrl,
  ME_QUERY_KEY,
  OAUTH_PROVIDER_OPTIONS,
  OAUTH_UNLINK_GUIDE,
  oauthAccountErrorMessage,
  oauthProviderName,
  startOAuthLink,
  takeOAuthLinkResult,
  unlinkOAuthAccount,
  type OAuthLinkResult,
  type OAuthProvider,
  type UserMeResponse
} from "@/entities/user";
import { setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import googlePart1 from "@/shared/assets/svg/settings/google-part-1.svg";
import googlePart2 from "@/shared/assets/svg/settings/google-part-2.svg";
import googlePart3 from "@/shared/assets/svg/settings/google-part-3.svg";
import googlePart4 from "@/shared/assets/svg/settings/google-part-4.svg";
import kakaoSymbol from "@/shared/assets/svg/settings/kakao-symbol.svg";
import naverTile from "@/shared/assets/svg/settings/naver-tile.svg";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import panelStyles from "./ProfilePanel.module.css";

/** 시안(1691:16834)의 서비스 이름. 로그인 화면·안내 문구는 entities의 이름(Google)을 그대로 쓴다. */
const PROVIDER_LABELS: Record<OAuthProvider, string> = { kakao: "카카오", naver: "네이버", google: "구글" };

/** 서비스 로고 칸 52px (Figma 1691:16921 카카오 / 1691:16931 네이버 / 1691:16969 구글). */
function ProviderLogo({ provider }: { provider: OAuthProvider }) {
  if (provider === "naver") {
    return <Image src={naverTile} alt="" aria-hidden className={panelStyles["provider-logo"]} />;
  }
  if (provider === "kakao") {
    return (
      <span className={cx(panelStyles["provider-logo"], panelStyles["is-kakao"])} aria-hidden>
        <Image src={kakaoSymbol} alt="" className={panelStyles["kakao-symbol"]} />
      </span>
    );
  }
  return (
    <span className={cx(panelStyles["provider-logo"], panelStyles["is-google"])} aria-hidden>
      {/* 구글 로고는 시안에서 색별 조각 4개를 같은 자리에 겹친 그림이다 */}
      {[googlePart1, googlePart2, googlePart3, googlePart4].map((part, index) => (
        <Image key={index} src={part} alt="" className={panelStyles["google-part"]} />
      ))}
    </span>
  );
}

/** 사용자 설정 > 연동된 계정 (Figma 1691:16834): 서비스별 2열 격자, 행마다 로고·상태·연동 버튼. */
export function LinkedAccountsSection({ me }: { me: UserMeResponse | undefined }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [result, setResult] = useState<OAuthLinkResult | null>(null);
  const linkedProviders = me?.oauth_providers ?? [];

  // 연동 콜백이 남긴 결과를 한 번만 읽어 이 섹션에 보여 준다.
  useEffect(() => {
    const linkResult = takeOAuthLinkResult();
    if (linkResult) setResult(linkResult);
  }, []);

  // 소셜 인증 화면에서 뒤로 가기로 bfcache 복원되면 이동 직전의 "처리 중" 상태가 그대로 남는다.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(null);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function link(provider: OAuthProvider) {
    setPending(provider);
    setResult(null);
    try {
      const linkToken = await startOAuthLink(provider);
      // 소셜 인증을 마치면 콜백 페이지가 이 화면으로 되돌려 보낸다.
      setAfterLoginPath(`${window.location.pathname}${window.location.search}`);
      window.location.assign(getOAuthLinkAuthorizationUrl(provider, linkToken));
    } catch (error: unknown) {
      setResult({ ok: false, message: oauthAccountErrorMessage(error, "소셜 계정 연동을 시작하지 못했습니다.") });
      setPending(null);
    }
  }

  async function unlink(provider: OAuthProvider) {
    setPending(provider);
    setResult(null);
    try {
      await unlinkOAuthAccount(provider);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      setResult({ ok: true, message: `${oauthProviderName(provider)} 연동을 해제했습니다.` });
    } catch (error: unknown) {
      setResult({ ok: false, message: oauthAccountErrorMessage(error, "소셜 계정 연동을 해제하지 못했습니다.") });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.section}>
      <SettingsSectionHeader>연동된 계정</SettingsSectionHeader>
      <ul className={panelStyles["provider-grid"]} aria-label="연동된 계정">
        {OAUTH_PROVIDER_OPTIONS.map(({ provider }) => {
          const isLinked = linkedProviders.includes(provider);
          const label = PROVIDER_LABELS[provider];
          return (
            <li className={panelStyles["provider-row"]} key={provider}>
              <div className={panelStyles["provider-title"]}>
                <ProviderLogo provider={provider} />
                <div className={panelStyles["provider-text"]}>
                  <strong>{label}</strong>
                  <small>{isLinked ? "연동됨" : "연동되지 않음"}</small>
                </div>
              </div>
              <button
                type="button"
                className={styles.btn}
                aria-label={`${label} ${isLinked ? "연동 해제" : "연동"}`}
                disabled={!me || pending !== null}
                onClick={() => void (isLinked ? unlink(provider) : link(provider))}
              >
                {pending === provider ? "처리 중…" : isLinked ? "연동 해제" : "연동"}
              </button>
            </li>
          );
        })}
      </ul>
      {/* 해제한 소셜 계정으로 다시 로그인해도 두 번째 계정이 생기지 않고 이메일 로그인·재연동으로 안내된다(access #31). */}
      <small className={styles["status-text"]}>{OAUTH_UNLINK_GUIDE}</small>
      {result && (result.ok
        ? <small className={styles["status-text"]} role="status">{result.message}</small>
        : <small className={styles["field-error"]} role="alert">{result.message}</small>)}
    </div>
  );
}
