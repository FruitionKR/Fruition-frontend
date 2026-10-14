"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/entities/user";
import styles from "./LandingPage.module.css";

export default function LandingPage() {
  const router = useRouter();
  // access token은 메모리에만 있어 새 탭에서는 비어 있지만, HttpOnly refresh 쿠키가 살아 있으면
  // /me 호출이 재발급을 거쳐 성공한다. 이미 로그인한 사용자는 로그인 화면을 거치지 않고 바로 들어간다.
  const { isSuccess } = useMe();

  useEffect(() => {
    if (isSuccess) router.replace("/workspaces");
  }, [isSuccess, router]);

  return (
    <main className={styles["landing-page"]}>
      <nav className={styles["landing-nav"]} aria-label="주요 메뉴">
        <span className={styles["landing-brand"]}>Fruition</span>
        <Link className={styles["landing-login-link"]} href="/login">
          로그인
        </Link>
      </nav>

      <section className={styles["landing-hero"]} aria-labelledby="landing-title">
        <p className={styles["landing-eyebrow"]}>AI RESEARCH WORKSPACE</p>
        <h1 id="landing-title">자료를 연결하고, 생각을 완성하세요.</h1>
        <p className={styles["landing-description"]}>
          문서와 지식을 한곳에 모아 탐색하고, AI와 함께 더 빠르게 인사이트를 발견하세요.
        </p>
      </section>
    </main>
  );
}
