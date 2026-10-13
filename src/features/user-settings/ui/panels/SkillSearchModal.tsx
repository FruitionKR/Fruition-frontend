"use client";

import { useMemo, useState } from "react";
import type { SkillResponse } from "@/entities/skill";
import { CenteredModal } from "@/shared/ui/CenteredModal";
import { SearchModalHeader } from "@/shared/ui/SearchModalHeader";
import { lightningIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./SkillSearchModal.module.css";

/** 스킬 검색 모달. 네비게이션 검색(DocumentSearch)과 같은 중앙 모달 형태로, 대상만 스킬이다. */
export function SkillSearchModal({
  skills,
  onSelect,
  onClose
}: {
  skills: SkillResponse[];
  onSelect: (skill: SkillResponse) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return skills;
    return skills.filter((skill) => {
      const description = (skill.enabled_version ?? skill.latest_version)?.description ?? "";
      return `${skill.slug} ${description}`.toLowerCase().includes(normalizedQuery);
    });
  }, [skills, normalizedQuery]);

  return (
    <CenteredModal ariaLabel="스킬 검색" onClose={onClose}>
      <SearchModalHeader placeholder="스킬 검색" value={query} onChange={setQuery} onClose={onClose} />
      <div className={styles["search-body"]}>
        <div className={styles["search-results"]} role="group" aria-label="스킬 검색 결과">
          {results.length > 0 ? (
            results.map((skill) => {
              const description = (skill.enabled_version ?? skill.latest_version)?.description ?? "";
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={styles["search-result"]}
                  onClick={() => {
                    onSelect(skill);
                    onClose();
                  }}
                >
                  <span className={styles["search-result-title"]}>
                    <SvgIcon src={lightningIcon} className={styles["search-result-icon"]} />
                    <span className={styles["search-result-label"]}>/{skill.slug}</span>
                  </span>
                  <span className={styles["search-result-meta"]}>{description}</span>
                </button>
              );
            })
          ) : (
            <p className={styles["search-empty"]}>
              {normalizedQuery ? "검색 결과가 없습니다." : "표시할 스킬이 없습니다."}
            </p>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
