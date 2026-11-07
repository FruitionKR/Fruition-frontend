import { useTranslations } from "next-intl";
import { SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "@/widgets/skills-view/ui/SkillIcons";
import base from "./Preview.module.css";
import styles from "./PreviewPages.module.css";

/* 멤버 관리 화면 조각. Figma 1540:21567(member)을 따른다. */

/** 이름과 아바타 글자는 landing.preview.members.people.<id>에 있다. */
const MEMBERS = [
  { id: "jisoo", email: "jisoo@example.com", role: "OWNER" },
  { id: "minsoo", email: "minsoo@example.com", role: "OWNER" },
  { id: "seoyeon", email: "seoyeon@example.com", role: "MEMBER" }
] as const;

/** 설정 › 멤버 관리 목록 조각 (Figma 1540:21567) */
export function MembersPane() {
  const t = useTranslations("landing.preview.members");
  return (
    <div className={styles["page"]}>
      <header className={styles["page-title"]}>
        <h1>{t("title")}</h1>
        <p>{t("description")}</p>
      </header>
      <div className={styles["member-toolbar"]}>
        <span>{t.rich("total", { count: MEMBERS.length, strong: (chunks) => <strong>{chunks}</strong> })}</span>
        <span className={styles["page-tools"]}>
          <SkillSearchIcon />
          <span className={styles["filter"]}>{t("roleFilter")}</span>
          <span className={base["button-primary"]} data-size="small">
            {t("invite")}
          </span>
        </span>
      </div>
      <table className={styles["table"]} data-variant="members">
        <thead>
          <tr>
            <th>
              <span className={styles["checkbox"]} />
              {t("user")} <SkillSortIcon />
            </th>
            <th>{t("role")}</th>
            <th aria-label={t("more")} />
          </tr>
        </thead>
        <tbody>
          {MEMBERS.map((member) => (
            <tr key={member.email}>
              <td>
                <span className={styles["checkbox"]} />
                <span className={styles["member-avatar"]}>{t(`people.${member.id}.initial`)}</span>
                <span className={styles["member-name"]}>
                  <strong>{t(`people.${member.id}.name`)}</strong>
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
