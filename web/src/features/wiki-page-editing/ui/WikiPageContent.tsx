"use client";

import { useCallback } from "react";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";
import { cx } from "@/shared/lib/classNames";
import type { WikiPageDetailResponse } from "@/entities/wiki";
import { useWikiPageEdit } from "../model/useWikiPageEdit";
import { WIKI_EDIT_PERMISSION_HINT } from "../model/wikiPageEdit";
import { DynamicWikiPageEditor } from "./DynamicWikiPageEditor";
import styles from "./WikiPageContent.module.css";

const DISCARD_CONFIRM_MESSAGE = "편집한 내용을 버리시겠습니까?";

/**
 * 위키 페이지 본문. 보기 모드는 읽기 전용 Markdown과 "편집" 버튼, 편집 모드는 Milkdown 편집기와 저장·취소다.
 * 저장 충돌(409)이면 내 편집은 편집기에 남기고 최신 서버 본문을 접어 보여 비교하게 한다.
 */
export function WikiPageContent({
  page,
  canEdit,
  onPageChange,
  onSaved
}: {
  page: WikiPageDetailResponse;
  /** 역할·권한으로 본 편집 가능 여부. 아니면 버튼을 비활성하고 이유를 보여 준다. */
  canEdit: boolean;
  /** 저장·충돌 뒤 페이지 상태를 바꾼다(markdown·revision). */
  onPageChange: (next: WikiPageDetailResponse) => void;
  /** 저장이 끝난 뒤 그래프 등 바깥 데이터를 다시 받는다. */
  onSaved?: () => void;
}) {
  const handleSaved = useCallback((next: { markdown: string; revision: number; updated_at: string }) => {
    onPageChange({ ...page, ...next });
    onSaved?.();
  }, [onPageChange, onSaved, page]);
  const edit = useWikiPageEdit({ page, onSaved: handleSaved, onReplaced: onPageChange });
  const { state } = edit;

  if (state.mode === "view") {
    return (
      <>
        <div className={styles["wiki-page-actions"]}>
          <button type="button" onClick={edit.start} disabled={!canEdit} title={canEdit ? undefined : WIKI_EDIT_PERMISSION_HINT}>
            편집
          </button>
          {!canEdit && <span className={styles["wiki-page-hint"]}>{WIKI_EDIT_PERMISSION_HINT}</span>}
        </div>
        <MarkdownViewer markdown={page.markdown ?? ""} linkPolicy="inert-external" />
      </>
    );
  }

  const { conflict, isSaving, error } = state;
  const latest = conflict?.latest ?? null;
  const cancelEditing = () => {
    if (edit.isDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE)) return;
    edit.cancel();
  };

  return (
    <>
      <div className={styles["wiki-page-actions"]}>
        {conflict ? (
          <>
            <button type="button" className={cx(styles["is-primary"])} onClick={edit.saveOverLatest} disabled={isSaving || !latest}>
              내 편집을 최신 본문 위에 저장
            </button>
            <button type="button" onClick={edit.adoptLatest} disabled={isSaving || !latest}>내 편집 버리고 최신 본문 보기</button>
            {conflict.loadError && <button type="button" onClick={edit.reloadLatest}>최신 본문 다시 불러오기</button>}
            <button type="button" onClick={cancelEditing} disabled={isSaving}>취소</button>
          </>
        ) : (
          <>
            <button type="button" className={cx(styles["is-primary"])} onClick={edit.save} disabled={isSaving}>
              {isSaving ? "저장 중…" : "저장"}
            </button>
            <button type="button" onClick={cancelEditing} disabled={isSaving}>취소</button>
          </>
        )}
        {isSaving && <span className={styles["wiki-page-status"]} role="status">저장 중</span>}
        {conflict?.currentRevision !== null && conflict?.currentRevision !== undefined && (
          <span className={styles["wiki-page-status"]}>
            내 기준 revision {state.session.baseRevision} · 서버 revision {conflict.currentRevision}
          </span>
        )}
      </div>
      {error && <p className={styles["wiki-page-notice"]} role="alert">{error}</p>}
      {conflict && (
        <details className={styles["wiki-page-latest"]} open>
          <summary>최신 서버 본문{latest?.revision !== undefined ? ` (revision ${latest.revision})` : ""}</summary>
          <div>
            {conflict.isLoading && <DocumentLoading>최신 본문을 불러오는 중입니다.</DocumentLoading>}
            {conflict.loadError && <p role="alert">{conflict.loadError}</p>}
            {latest && <MarkdownViewer markdown={latest.markdown ?? ""} linkPolicy="inert-external" />}
          </div>
        </details>
      )}
      <DynamicWikiPageEditor initialMarkdown={state.session.draft} onChange={edit.updateDraft} />
    </>
  );
}
