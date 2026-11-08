"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ConsentChoices } from "@/entities/user";
import { PRIVACY_PATH, TERMS_PATH } from "@/shared/config/legal";

type ConsentItemProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  required: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
};

function ConsentItem({ id, checked, disabled, required, onChange, children }: ConsentItemProps) {
  const t = useTranslations("shared.legalConsent");
  return (
    <div className="auth-consent-item">
      <input checked={checked} disabled={disabled} id={id} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <label htmlFor={id}>
        <span className={required ? "auth-consent-tag auth-consent-tag--required" : "auth-consent-tag"}>{required ? t("required") : t("optional")}</span>
        {children}
      </label>
    </div>
  );
}

/**
 * 가입·재동의 공통 동의 항목. 어떤 항목도 미리 체크하지 않으며, 체크 상태는 호출부가 가진다.
 * 처리방침은 동의 체크 없이 전문 링크만 보여 준다(계약 이행 근거로 처리).
 */
export function ConsentForm({
  value,
  onChange,
  disabled = false,
  idPrefix = "consent"
}: {
  value: ConsentChoices;
  onChange: (next: ConsentChoices) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations("shared.legalConsent");
  const termsLink = (chunks: React.ReactNode) => <Link href={TERMS_PATH} rel="noopener" target="_blank">{chunks}</Link>;
  const privacyLink = (chunks: React.ReactNode) => <Link href={PRIVACY_PATH} rel="noopener" target="_blank">{chunks}</Link>;
  return (
    <fieldset className="auth-consent" disabled={disabled}>
      <legend className="auth-consent-legend">{t("legend")}</legend>
      <ConsentItem
        checked={value.ageConfirmed}
        disabled={disabled}
        id={`${idPrefix}-age`}
        onChange={(ageConfirmed) => onChange({ ...value, ageConfirmed })}
        required
      >
        {t("age")}
      </ConsentItem>
      <ConsentItem
        checked={value.termsAccepted}
        disabled={disabled}
        id={`${idPrefix}-terms`}
        onChange={(termsAccepted) => onChange({ ...value, termsAccepted })}
        required
      >
        {t.rich("terms", { link: termsLink })}
      </ConsentItem>
      <ConsentItem
        checked={value.marketingOptIn}
        disabled={disabled}
        id={`${idPrefix}-marketing`}
        onChange={(marketingOptIn) => onChange({ ...value, marketingOptIn })}
        required={false}
      >
        {t("marketing")}
      </ConsentItem>
      <p className="auth-consent-note">
        {t.rich("privacy", { link: privacyLink })}
      </p>
    </fieldset>
  );
}
