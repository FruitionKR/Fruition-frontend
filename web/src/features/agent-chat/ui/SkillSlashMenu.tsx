"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import arrowDownBodyIcon from "@/shared/assets/svg/common/arrow-down-body.svg";
import type { SlashSkillGroup } from "../lib/skillSlashMenu";
import styles from "./SkillSlashMenu.module.css";

/**
 * 채팅 입력창 "/" 스킬 목록 (Figma 1627:9886). 종류별로 묶은 스킬과 하단 안내·스킬 관리 링크.
 * 키보드(↑↓·Tab·Enter·Esc)는 입력창에 포커스를 둔 채 AgentPanel이 처리하고, 여기서는 강조 항목만 그린다.
 */
export function SkillSlashMenu({
  id,
  groups,
  activeSkillId,
  isLoading,
  onPick,
  onManage
}: {
  id: string;
  groups: readonly SlashSkillGroup[];
  activeSkillId: string | null;
  isLoading: boolean;
  onPick: (slug: string) => void;
  onManage?: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 화살표로 옮긴 강조 항목이 목록 밖에 있으면 보이게 스크롤한다.
  useEffect(() => {
    if (!activeSkillId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-skill-id="${CSS.escape(activeSkillId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeSkillId]);

  return (
    <div className={styles.menu}>
      <div ref={listRef} id={id} role="listbox" aria-label="스킬" className={styles.groups}>
        {groups.length === 0 && (
          <p className={styles.empty}>{isLoading ? "스킬을 불러오는 중…" : "일치하는 스킬이 없어요."}</p>
        )}
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className={styles.group}>
            <p className={styles["group-label"]} aria-hidden>
              {group.label}
            </p>
            {group.skills.map((skill) => {
              const isActive = skill.id === activeSkillId;
              return (
                <div
                  key={skill.id}
                  id={`${id}-${skill.id}`}
                  data-skill-id={skill.id}
                  role="option"
                  aria-selected={isActive}
                  className={cx(styles.item, isActive && styles["is-active"])}
                  // 입력창 포커스를 잃지 않게 mousedown 기본 동작을 막고 클릭으로 고른다.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(skill.slug)}
                >
                  <span className={styles.slug}>/{skill.slug}</span>
                  {skill.description && <span className={styles.description}>{skill.description}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <hr className={styles.divider} />
      <div className={styles.footer}>
        <p className={styles.hint}>스킬 없이 질문·요청하려면 Enter</p>
        {onManage && (
          <button type="button" className={styles.manage} onMouseDown={(event) => event.preventDefault()} onClick={onManage}>
            스킬 관리
            <SvgIcon src={arrowDownBodyIcon} className={styles["manage-icon"]} />
          </button>
        )}
      </div>
    </div>
  );
}
