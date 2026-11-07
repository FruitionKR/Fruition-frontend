"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LANDING_NAV } from "../model/landingContent";
import { LanguageSwitch } from "./LanguageSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./LandingPage.module.css";

/** 좁은 화면의 헤더 메뉴. 넓은 화면에서는 CSS로 숨기고, 헤더의 메뉴·테마·언어 선택을 그대로 쓴다. */
export function LandingMobileMenu() {
  const t = useTranslations("landing");
  const tLanguage = useTranslations("common.language");
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={styles["mobile-menu"]}>
      <button
        ref={buttonRef}
        type="button"
        className={styles["menu-button"]}
        aria-label={t("header.menu")}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d={isOpen ? "M5 5l10 10M15 5L5 15" : "M3 6h14M3 10h14M3 14h14"}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div id={panelId} className={styles["menu-panel"]} hidden={!isOpen}>
        <nav aria-label={t("header.nav")}>
          <ul>
            {LANDING_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} replace onClick={() => setIsOpen(false)}>
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles["menu-theme"]}>
          <span>{t("header.theme")}</span>
          {isOpen ? <ThemeSwitch /> : null}
        </div>
        <div className={styles["menu-theme"]}>
          <span>{tLanguage("label")}</span>
          {isOpen ? <LanguageSwitch /> : null}
        </div>
      </div>
    </div>
  );
}
