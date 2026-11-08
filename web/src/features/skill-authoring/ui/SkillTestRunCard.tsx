"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { fetchDocuments } from "@/entities/document";
import { testRunSkill } from "@/entities/skill";
import { cx } from "@/shared/lib/classNames";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import lightningSmallIcon from "@/shared/assets/svg/common/lightning-small.svg";
import { documentDisplayName, pickerDocuments } from "../lib/referenceDocumentPicker";
import { skillCapabilities, type SkillCreateForm } from "../lib/skillCreateForm";
import {
  describeSkillTestRunError,
  newSkillTestRunId,
  skillChangeDiffLines,
  skillTestRunBlocker,
  skillTestRunRequest,
  skillTestRunView,
  supportsSkillTestRun
} from "../lib/skillTestRun";
import { issueText } from "./SkillFormParts";
import styles from "./SkillTestRunCard.module.css";

const NO_DOCUMENT = "";
const DIFF_LINE_CLASS = { delete: styles.before, insert: styles.after, context: styles.context } as const;
// 색만으로 구분하지 않도록 화면 낭독기에 줄 종류를 읽어 준다(맥락 줄은 읽지 않는다).
const DIFF_LINE_LABEL_KEY = { delete: "testRun.deletedLine", insert: "testRun.insertedLine" } as const;

/**
 * "테스트 실행" 묶음 (Figma 1671:14585): 묶음 이름(label) · 카드 · 다시 테스트 칩. 스킬 시트가 열린 동안 채팅 패널 입력창 위에 둔다.
 * 지금 시트에 적은 정의를 고른 문서 하나 전체에 적용해 섹션별 변경 전/후를 보여 준다. 문서·스킬은 저장하지 않는다.
 */
export function SkillTestRunCard({ workspaceId, form, label }: { workspaceId: string; form: SkillCreateForm; label: string }) {
  const t = useTranslations("skills");
  const tShared = useTranslations("shared");
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const [documentId, setDocumentId] = useState(NO_DOCUMENT);

  const isSupported = supportsSkillTestRun(form.kind);
  const { data: documents, isLoading: isDocumentsLoading } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: fetchDocuments,
    enabled: isSupported
  });
  // 테스트 실행은 Markdown 문서만 받는다(그 밖의 원본은 400). 참고 문서 피커와 같은 기준으로 고른다.
  const candidates = pickerDocuments(documents ?? [], "");
  const documentOptions = candidates.map((doc) => ({ value: doc.id, label: documentDisplayName(doc) }));

  const blocker = skillTestRunBlocker(form, documentId);

  const runMutation = useMutation({
    // run_id는 한 번만 쓸 수 있어 실행할 때마다 새로 만든다.
    mutationFn: async () => {
      const capabilities = skillCapabilities(form.kind, form.resultMode);
      const result = await testRunSkill(workspaceId, skillTestRunRequest(form, documentId), newSkillTestRunId());
      return skillTestRunView(result, capabilities);
    }
  });
  const view = runMutation.data;
  const hasRun = view != null || runMutation.isError;

  // 폴더 정리 스킬: 테스트할 문서 고르기 없이 안내만 둔다.
  if (!isSupported) {
    return (
      <section className={styles.container} aria-labelledby={fieldId("title")}>
        <p className={styles.group}>{label}</p>
        <div className={styles.card}>
          <div className={styles.heading}>
            <p id={fieldId("title")} className={styles.title}>
              {t("testRun.title")}
            </p>
            <p className={styles.sub}>{t("testRun.folderNote")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.container} aria-labelledby={fieldId("title")}>
      <p className={styles.group}>{label}</p>
      <div className={styles.card}>
        <div className={styles.heading}>
          <p id={fieldId("title")} className={styles.title}>
            {t("testRun.title")}
          </p>
          <p className={styles.sub}>{t("testRun.subtitle")}</p>
        </div>

        <div className={styles.box}>
          <div className={styles.picker}>
            <label className={styles["sr-only"]} htmlFor={fieldId("document")}>
              {t("testRun.documentLabel")}
            </label>
            <OptionSelect
              id={fieldId("document")}
              value={documentId}
              placeholder={isDocumentsLoading ? t("testRun.documentsLoading") : t("testRun.documentPlaceholder")}
              options={documentOptions}
              onChange={setDocumentId}
            />
            {!isDocumentsLoading && candidates.length === 0 && (
              <p className={styles.note}>{t("testRun.noDocuments")}</p>
            )}
          </div>

          <div className={styles.result} role="status" aria-live="polite" aria-busy={runMutation.isPending}>
            {runMutation.isPending && <p className={styles.note}>{t("testRun.running")}</p>}
            {!runMutation.isPending && runMutation.isError && (
              <p className={styles.error} role="alert">
                {describeSkillTestRunError(runMutation.error, t, tShared)}
              </p>
            )}
            {!runMutation.isPending && view != null && <SkillTestRunResult view={view} />}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles["run-button"]}
          disabled={blocker != null || runMutation.isPending}
          aria-describedby={blocker != null ? fieldId("blocker") : undefined}
          onClick={() => runMutation.mutate()}
        >
          <SvgIcon src={lightningSmallIcon} className={styles["run-icon"]} />
          {runMutation.isPending ? t("testRun.runningButton") : hasRun ? t("testRun.rerun") : t("testRun.title")}
        </button>
        {blocker != null && (
          <p id={fieldId("blocker")} className={styles.note}>
            {t(`testRun.blocker.${blocker}`)}
          </p>
        )}
      </div>
    </section>
  );
}

function SkillTestRunResult({ view }: { view: NonNullable<ReturnType<typeof skillTestRunView>> }) {
  const t = useTranslations("skills");
  if (view.kind === "blocked") {
    return (
      <div className={styles.blocked} role="alert">
        <p className={styles["blocked-title"]}>{t("testRun.blockedTitle")}</p>
        <ul className={styles["issue-list"]}>
          {(view.issues.length > 0 ? view.issues : [t("review.issueFallback")]).map((issue, index) => (
            <li key={index}>{issueText(issue, t)}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (view.kind === "created") {
    return (
      <div className={styles.list}>
        <p className={styles.section}>{t("testRun.created")}</p>
        <pre className={cx(styles.diff, styles.created)}>{view.markdown}</pre>
      </div>
    );
  }
  if (view.kind === "unchanged") {
    return <p className={styles.note}>{t("testRun.unchanged")}</p>;
  }
  return (
    <div className={styles.list}>
      {view.changes.map((change, index) => (
        <div key={`${change.start_line}-${index}`} className={styles.change}>
          <p className={styles.section}>
            {t("testRun.changeHeading", { section: change.section, start: change.start_line, end: change.end_line })}
          </p>
          {/* Figma 1671:14822: 지운 줄은 빨강 취소선, 새 줄은 파랑(묶음 첫 줄에 →), 그대로인 줄은 맥락으로 흐리게. */}
          <div className={styles.diff} aria-label={t("testRun.diffLabel")}>
            {skillChangeDiffLines(change).map((line, lineIndex, lines) => (
              <p key={`${line.type}-${lineIndex}`} className={DIFF_LINE_CLASS[line.type]}>
                {line.type !== "context" && <span className={styles["sr-only"]}>{t(DIFF_LINE_LABEL_KEY[line.type])}</span>}
                {line.type === "insert" && lines[lineIndex - 1]?.type !== "insert" && <span aria-hidden>→ </span>}
                {line.text || " "}
              </p>
            ))}
          </div>
        </div>
      ))}
      {view.untouchedSections.length > 0 && (
        <p className={styles.section}>{t("testRun.untouched", { sections: view.untouchedSections.join(" · ") })}</p>
      )}
    </div>
  );
}
