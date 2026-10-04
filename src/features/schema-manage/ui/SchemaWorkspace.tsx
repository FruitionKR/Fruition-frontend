"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SchemaWorkspace.module.css";
import { SchemaEditorForm } from "./SchemaEditorForm";
import { SchemaList } from "./SchemaList";
import { SchemaPreviewCard } from "./SchemaPreviewCard";
import {
  activateWikiSchema,
  createWikiSchemaDraft,
  fetchActiveWikiSchema,
  previewWikiSchema
} from "@/entities/schema/api/schema";
import { getErrorMessage } from "@/shared/lib/errors";
import type { WikiSchema, WikiSchemaPreview } from "@/entities/schema/model/schema";

// 스킬(스키마) 관리 임시 화면. rail "규칙" 뷰에 마운트된다.
// 서버는 활성 스킬 조회만 제공하고 초안 목록 API가 없다. 그래서 목록은 활성 스킬과
// 이 화면에서 방금 만든 초안만 보여준다. 새로 고치면 저장된 초안은 다시 찾을 수 없다.
export function SchemaWorkspace() {
  const [activeSchema, setActiveSchema] = useState<WikiSchema | null>(null);
  const [sessionDrafts, setSessionDrafts] = useState<WikiSchema[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [preview, setPreview] = useState<WikiSchemaPreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setActiveSchema(await fetchActiveWikiSchema());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const schemas = useMemo<WikiSchema[]>(() => {
    const drafts = sessionDrafts.filter((draft) => draft.id !== activeSchema?.id);
    return activeSchema ? [...drafts, activeSchema] : drafts;
  }, [activeSchema, sessionDrafts]);

  const selectedPreview = useMemo<WikiSchemaPreview | null>(() => {
    const selected = schemas.find((schema) => schema.id === selectedId);
    if (!selected) return null;
    return {
      fragments: selected.fragments,
      issues: selected.issues,
      previewMarkdown: selected.previewMarkdown,
      hasBlockedIssues: selected.hasBlockedIssues
    };
  }, [schemas, selectedId]);

  async function run(task: () => Promise<void>) {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      await task();
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "요청을 처리하지 못했습니다."));
    } finally {
      setIsBusy(false);
    }
  }

  function handlePreview() {
    void run(async () => {
      setSelectedId(null);
      setPreview(await previewWikiSchema(rawMarkdown));
    });
  }

  function handleSaveDraft() {
    void run(async () => {
      const draft = await createWikiSchemaDraft(rawMarkdown, name);
      setSessionDrafts((previous) => [draft, ...previous]);
      setSelectedId(draft.id);
      setPreview(null);
    });
  }

  function handleActivate(schema: WikiSchema) {
    void run(async () => {
      const activated = await activateWikiSchema(schema.id);
      setActiveSchema(activated);
      setSelectedId(activated.id);
    });
  }

  return (
    <section className={styles["schema-workspace"]} aria-label="스킬 관리">
      <div className={styles["schema-column"]}>
        <header className={styles["schema-header"]}>
          <h2>스킬</h2>
          <p>원하는 형태로 스킬을 작성하면 AI 편집/생성에 반영됩니다. (현재 임시 화면)</p>
        </header>
        {errorMessage && <p className={styles["schema-error"]} role="alert">{errorMessage}</p>}
        <SchemaList
          schemas={schemas}
          selectedId={selectedId}
          isBusy={isBusy}
          onSelect={(schema) => {
            setSelectedId(schema.id);
            setPreview(null);
          }}
          onActivate={handleActivate}
        />
      </div>

      <div className={styles["schema-column"]}>
        <SchemaEditorForm
          name={name}
          rawMarkdown={rawMarkdown}
          isBusy={isBusy}
          onNameChange={setName}
          onMarkdownChange={setRawMarkdown}
          onPreview={handlePreview}
          onSaveDraft={handleSaveDraft}
        />
        {preview && <SchemaPreviewCard preview={preview} />}
        {!preview && selectedPreview && (
          <SchemaPreviewCard
            preview={selectedPreview}
            onActivate={selectedId ? () => {
              const selected = schemas.find((schema) => schema.id === selectedId);
              if (selected && selected.status !== "active") handleActivate(selected);
            } : undefined}
          />
        )}
      </div>
    </section>
  );
}
