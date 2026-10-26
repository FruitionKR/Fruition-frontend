"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import { cx } from "@/shared/lib/classNames";
import { LANDING_CHAPTERS, type LandingChapterId } from "../model/landingContent";
import { pickActiveChapter } from "../model/sectionSpy";
import styles from "./SectionTabs.module.css";

// 화면 높이 45% 지점의 가는 띠(45%~46%)에 걸친 장을 현재 장으로 본다. 장 띠가 이어져 있어 늘 하나가 걸린다.
const SPY_ROOT_MARGIN = "-45% 0px -54% 0px";
const AREA_ROOT_MARGIN = "-72px 0px -80% 0px";

/**
 * 장 고정 탭. 히어로가 보이는 동안은 숨고, 장 영역에 들어오면 헤더 아래 가운데에 알약 모양으로 떠서 현재 장을 강조한다.
 * 스크롤 이벤트 대신 IntersectionObserver로만 상태를 바꾼다. 링크 이동의 부드러운 스크롤은 랜딩 CSS가
 * 움직임 줄이기 설정을 확인해 켠다.
 */
export function SectionTabs() {
  const [isShown, setIsShown] = useState(false);
  const [active, setActive] = useState<LandingChapterId | null>(null);

  useEffect(() => {
    const chapters = document.getElementById("chapters");
    if (!chapters || typeof IntersectionObserver === "undefined") return;

    // 장 영역이 헤더 바로 아래 띠(화면 위 20%)까지 올라온 동안만 탭을 띄운다. 히어로·장 목차 카드 위에는 뜨지 않는다.
    const areaObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) setIsShown(entry.isIntersecting);
    }, { rootMargin: AREA_ROOT_MARGIN });
    areaObserver.observe(chapters);

    const visible = new Set<LandingChapterId>();
    const spyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.id as LandingChapterId;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      setActive((current) => pickActiveChapter(visible, current));
    }, { rootMargin: SPY_ROOT_MARGIN });
    for (const chapter of LANDING_CHAPTERS) {
      const element = document.getElementById(chapter.id);
      if (element) spyObserver.observe(element);
    }

    return () => {
      areaObserver.disconnect();
      spyObserver.disconnect();
    };
  }, []);

  return (
    <nav className={cx(styles["section-tabs"], isShown && styles["is-shown"])} aria-label="장 바로가기" aria-hidden={!isShown}>
      <ul>
        {LANDING_CHAPTERS.map((chapter) => {
          const isActive = active === chapter.id;
          return (
            <li key={chapter.id}>
              <Link
                href={`#${chapter.id}`}
                className={cx(styles["tab"], isActive && styles["is-active"])}
                aria-current={isActive ? "true" : undefined}
                tabIndex={isShown ? undefined : -1}
              >
                {chapter.tabLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
