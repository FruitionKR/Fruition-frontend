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
  fetchWikiSchemaDrafts,
  previewWikiSchema
} from "@/entities/schema/api/schema";
import { getErrorMessage } from "@/shared/lib/errors";
import type { WikiSchema, WikiSchemaPreview } from "@/entities/schema/model/schema";

// 스킬(스키마) 관리 임시 화면. rail "규칙" 뷰에 마운트된다.
// 초안 목록과 활성 스킬은 엔드포인트가 나뉘어 있어 둘을 함께 조회해 한 목록으로 합친다.
export function SchemaWorkspace() {
  const [activeSchema, setActiveSchema] = useState<WikiSchema | null>(null);
  const [drafts, setDrafts] = useState<WikiSchema[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [preview, setPreview] = useState<WikiSchemaPreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextDrafts, nextActive] = await Promise.all([fetchWikiSchemaDrafts(), fetchActiveWikiSchema()]);
    setDrafts(nextDrafts);
    setActiveSchema(nextActive);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const schemas = useMemo<WikiSchema[]>(
    () => (activeSchema ? [...drafts, activeSchema] : drafts),
    [activeSchema, drafts]
  );

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
      await refresh();
      setSelectedId(draft.id);
      setPreview(null);
    });
  }

  function handleActivate(schema: WikiSchema) {
    void run(async () => {
      const activated = await activateWikiSchema(schema.id);
      // 활성화는 기존 활성 스킬을 draft로 되돌리므로 목록까지 다시 읽는다.
      await refresh();
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
