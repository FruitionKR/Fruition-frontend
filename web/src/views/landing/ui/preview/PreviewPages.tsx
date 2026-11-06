import { SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "@/widgets/skills-view/ui/SkillIcons";
import base from "./Preview.module.css";
import styles from "./PreviewPages.module.css";

/* 멤버 관리 화면 조각. Figma 1540:21567(member)을 따른다. */

const MEMBERS = [
  { name: "김지수", email: "jisoo@example.com", role: "OWNER" },
  { name: "박민수", email: "minsoo@example.com", role: "OWNER" },
  { name: "이서연", email: "seoyeon@example.com", role: "MEMBER" }
] as const;

/** 설정 › 멤버 관리 목록 조각 (Figma 1540:21567) */
export function MembersPane() {
  return (
    <div className={styles["page"]}>
      <header className={styles["page-title"]}>
        <h1>멤버 관리</h1>
        <p>워크스페이스에 있는 사람과 역할을 관리합니다.</p>
      </header>
      <div className={styles["member-toolbar"]}>
        <span>
          총 <strong>{MEMBERS.length}</strong>명
        </span>
        <span className={styles["page-tools"]}>
          <SkillSearchIcon />
          <span className={styles["filter"]}>권한 ⌄</span>
          <span className={base["button-primary"]} data-size="small">
            멤버 초대하기
          </span>
        </span>
      </div>
      <table className={styles["table"]} data-variant="members">
        <thead>
          <tr>
            <th>
              <span className={styles["checkbox"]} />
              사용자 <SkillSortIcon />
            </th>
            <th>사용 권한</th>
            <th aria-label="더보기" />
          </tr>
        </thead>
        <tbody>
          {MEMBERS.map((member) => (
            <tr key={member.email}>
              <td>
                <span className={styles["checkbox"]} />
                <span className={styles["member-avatar"]}>{member.name.slice(1, 2)}</span>
                <span className={styles["member-name"]}>
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                </span>
              </td>
              <td>{member.role} ⌄</td>
              <td>
                <SkillMoreIcon />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
