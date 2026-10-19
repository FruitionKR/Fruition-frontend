import skillPickerArrowIcon from "@/shared/assets/svg/agent/skill-picker-arrow.svg";
import { cx } from "@/shared/lib/classNames";
import type { SkillPickerGroup, SkillPickerItem } from "../lib/taskThread";
import { AgentAssetIcon } from "./AgentIcons";
import styles from "./AgentChat.module.css";

export const SKILL_PICKER_LIST_ID = "agent-skill-picker";

export function skillPickerOptionId(skillId: string) {
  return `agent-skill-option-${skillId}`;
}

/**
 * 작업 입력창에 "/"를 치면 뜨는 스킬 고르기(Figma 1627:9886): 문서·폴더 정리 묶음별 /slug + 설명,
 * 아래에 "스킬 없이 질문·요청하려면 Enter"와 "스킬 관리 >".
 */
export function SkillSlashPicker({
  groups,
  activeSkillId,
  statusMessage,
  onPick,
  onHover,
  onManageSkills
}: {
  groups: SkillPickerGroup[];
  activeSkillId: string | null;
  /** 스킬 목록을 불러오는 중·실패·검색 결과 없음 안내 */
  statusMessage: string | null;
  onPick: (item: SkillPickerItem) => void;
  onHover: (skillId: string) => void;
  onManageSkills?: () => void;
}) {
  return (
    <div className={styles["skill-picker"]}>
      {groups.length > 0 ? (
        <div className={styles["skill-picker-groups"]} role="listbox" id={SKILL_PICKER_LIST_ID} aria-label="스킬">
          {groups.map((group) => (
            <div key={group.kind} className={styles["skill-picker-group"]} role="group" aria-label={group.label}>
              <p className={styles["skill-picker-group-label"]} aria-hidden>{group.label}</p>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  id={skillPickerOptionId(item.id)}
                  role="option"
                  aria-selected={item.id === activeSkillId}
                  className={cx(styles["skill-picker-option"], item.id === activeSkillId && styles["is-active"])}
                  // 입력창 포커스를 지킨 채 고른다.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => onHover(item.id)}
                  onClick={() => onPick(item)}
                >
                  <span className={styles["skill-picker-slug"]}>/{item.slug}</span>
                  {item.description && <span className={styles["skill-picker-description"]}>{item.description}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className={styles["skill-picker-empty"]} role="status">{statusMessage ?? "맞는 스킬이 없어요."}</p>
      )}
      <hr className={styles["skill-picker-divider"]} />
      <div className={styles["skill-picker-footer"]}>
        <span>스킬 없이 질문·요청하려면 Enter</span>
        {onManageSkills && (
          <button type="button" className={styles["skill-picker-manage"]} onMouseDown={(event) => event.preventDefault()} onClick={onManageSkills}>
            스킬 관리
            <AgentAssetIcon src={skillPickerArrowIcon} size={16} className={styles["skill-picker-manage-arrow"]} />
          </button>
        )}
      </div>
    </div>
  );
}
