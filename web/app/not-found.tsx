"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AuthScreen } from "@/shared/ui/auth/AuthScreen";
import styles from "./not-found.module.css";

export default function NotFound() {
  const t = useTranslations("common.notFound");

  return (
    <AuthScreen title={t("title")}>
      <p className={styles.description}>{t("description")}</p>
      <Link className={`auth-submit ${styles.back}`} href="/" prefetch={false}>
        {t("back")}
      </Link>
    </AuthScreen>
  );
}
