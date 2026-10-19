"use client";

import { useEffect, useState } from "react";
import { cx } from "@/shared/lib/classNames";
import { LANDING_CHAPTERS, type LandingChapterId } from "../model/landingContent";
import { pickActiveChapter } from "../model/sectionSpy";
import styles from "./SectionTabs.module.css";

// 헤더(72px)와 탭 바(52px) 아래에서 장이 보이기 시작하면 그 장을 현재 장으로 본다.
const SPY_ROOT_MARGIN = "-140px 0px -55% 0px";

/**
 * 장 고정 탭 바. 히어로가 보이는 동안은 숨고, 장 영역에 들어오면 헤더 아래에 나타나 현재 장을 강조한다.
 * 스크롤 이벤트 대신 IntersectionObserver로만 상태를 바꾼다. 링크 이동의 부드러운 스크롤은 랜딩 CSS가
 * 움직임 줄이기 설정을 확인해 켠다.
 */
export function SectionTabs() {
  const [isShown, setIsShown] = useState(false);
  const [active, setActive] = useState<LandingChapterId | null>(null);

  useEffect(() => {
    const hero = document.getElementById("top");
    const chapters = document.getElementById("chapters");
    if (!hero || !chapters || typeof IntersectionObserver === "undefined") return;

    let heroVisible = true;
    let chaptersVisible = false;
    const sync = () => setIsShown(!heroVisible && chaptersVisible);

    const areaObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) heroVisible = entry.isIntersecting;
        if (entry.target === chapters) chaptersVisible = entry.isIntersecting;
      }
      sync();
    }, { rootMargin: "-72px 0px 0px 0px" });
    areaObserver.observe(hero);
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
              <a
                href={`#${chapter.id}`}
                className={cx(styles["tab"], isActive && styles["is-active"])}
                aria-current={isActive ? "true" : undefined}
                tabIndex={isShown ? undefined : -1}
              >
                <span className={styles["tab-number"]}>{chapter.index}</span>
                {chapter.tabLabel}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
