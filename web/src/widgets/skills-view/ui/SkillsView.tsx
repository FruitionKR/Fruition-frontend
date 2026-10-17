"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { SkillResponse } from "@/entities/skill";
import { SkillCreateSheet } from "@/features/skill-authoring";
import { SkillSearchModal } from "./SkillSearchModal";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import {
  filterSkillsByTab,
  isPersonalSkill,
  nextSkillSort,
  skillCommand,
  skillDescription,
  sortSkills,
  type SkillSort,
  type SkillSortKey,
  type SkillTab
} from "../lib/skillTable";
import { useSkillCatalog, type SkillDraft } from "../model/useSkillCatalog";
import { SkillCheckMark, SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "./SkillIcons";
import styles from "./SkillsView.module.css";

const TABS: { id: SkillTab; label: string }[] = [
  { id: "all", label: "전체 스킬" },
  { id: "team", label: "팀 스킬" },
  { id: "personal", label: "개인 스킬" }
];

/** sortKey가 있는 열(커맨드·저장범위)만 머리글을 눌러 정렬한다 */
const COLUMNS: { label: string; className: string; sortKey?: SkillSortKey }[] = [
  { label: "커맨드", className: "col-command", sortKey: "command" },
  { label: "설명", className: "col-description" },
  { label: "저장범위", className: "col-scope", sortKey: "scope" },
  { label: "사용 상태", className: "col-state" }
];

/** Figma check(20×20): 테두리 상자 + 체크 표시. 실제 입력은 시각적으로 숨긴 checkbox다. */
function SkillCheckbox({ checked, label, disabled, onChange }: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <SkillCheckMark className={styles["check-mark"]} />
    </label>
  );
}

function ColumnHeader({ column, sort, onSort, children }: {
  column: (typeof COLUMNS)[number];
  sort: SkillSort;
  onSort: (key: SkillSortKey) => void;
  children?: ReactNode;
}) {
  const { sortKey } = column;
  const direction = sortKey && sort?.key === sortKey ? sort.direction : null;
  return (
    <div
      className={cx(styles.cell, styles[column.className])}
      role="columnheader"
      aria-sort={sortKey ? (direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none") : undefined}
    >
      {children}
      {sortKey ? (
        <button type="button" className={cx(styles["sort-button"], direction && styles["is-sorted"])} onClick={() => onSort(sortKey)}>
          {column.label}
          <SkillSortIcon className={styles["sort-icon"]} />
        </button>
      ) : (
        <span className={styles["column-label"]}>{column.label}</span>
      )}
    </div>
  );
}

/**
 * 스킬 화면 (Figma 1482:9848). 레일 번개로 연다.
 * 탭 = 저장범위 필터, 열 머리글 = 정렬, 커맨드 = 정의 수정, 실행 = 대상 문서 고르기(onRunSkill)로 넘어간다.
 */
export function SkillsView({ onRunSkill }: { onRunSkill: (skill: SkillResponse) => void }) {
  const workspaceId = getSelectedWorkspaceId();
  const catalog = useSkillCatalog(workspaceId);
  const { updateMutation, deleteMutation } = catalog;
  const idPrefix = useId();

  const [activeTab, setActiveTab] = useState<SkillTab>("all");
  const [sort, setSort] = useState<SkillSort>(null);
  const [searchText, setSearchText] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useDismissableMenu(openMenuId !== null, () => setOpenMenuId(null));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>({ description: "", instructionsMarkdown: "" });
  const [deleteTarget, setDeleteTarget] = useState<SkillResponse | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (deleteTarget) deleteDialogRef.current?.showModal();
    else deleteDialogRef.current?.close();
  }, [deleteTarget]);
  // 삭제 확인도 ESC 레이어로 등록해 Escape 한 번에 대화상자만 닫히게 한다(삭제 중에는 유지).
  useEscapeKey(deleteTarget !== null, () => {
    if (!deleteMutation.isPending) setDeleteTarget(null);
  });

  const visibleSkills = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const inTab = filterSkillsByTab(catalog.skills, activeTab).filter((skill) =>
      keyword.length === 0 || `${skill.slug} ${skillDescription(skill)}`.toLowerCase().includes(keyword)
    );
    return sortSkills(inTab, sort);
  }, [catalog.skills, activeTab, searchText, sort]);

  const isAllSelected = visibleSkills.length > 0 && visibleSkills.every((skill) => selectedIds.has(skill.id));

  function toggleSelected(skillId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
  }

  function openEditor(skill: SkillResponse) {
    const version = skill.enabled_version ?? skill.latest_version;
    updateMutation.reset();
    setEditingId(skill.id);
    setDraft({ description: version?.description ?? "", instructionsMarkdown: version?.instructions_markdown ?? "" });
  }

  function saveDraft(skill: SkillResponse) {
    updateMutation.mutate({ skill, draft }, {
      // 저장 중 다른 스킬 편집으로 바꿨을 수 있으니 저장한 스킬의 편집만 닫는다.
      onSuccess: () => setEditingId((current) => (current === skill.id ? null : current))
    });
  }

  const panelId = `${idPrefix}-panel`;
  const errorMessage = catalog.loadError ?? catalog.actionError;

  return (
    <section className={styles.skills} aria-labelledby={`${idPrefix}-title`}>
      <header className={styles.hero}>
        <div className={styles.heading}>
          <h1 id={`${idPrefix}-title`}>스킬</h1>
          <p>반복 작업을 안전한 실행 규칙으로 만들어 Fruition Agent에서 재사용합니다.</p>
        </div>
        <div className={styles.tabs}>
          <div role="tablist" aria-label="스킬 저장범위" className={styles["tab-list"]}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={panelId}
                className={cx(styles.tab, activeTab === tab.id && styles["is-active"])}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            {searchText && (
              <button type="button" className={styles["search-chip"]} aria-label="스킬 검색 해제" onClick={() => setSearchText("")}>
                검색 : {searchText}
                <span aria-hidden>✕</span>
              </button>
            )}
            <button type="button" className={styles["icon-button"]} aria-label="스킬 검색" onClick={() => setIsSearchOpen(true)}>
              <SkillSearchIcon />
            </button>
            <button
              type="button"
              className={styles["create-button"]}
              disabled={workspaceId == null}
              onClick={() => setIsCreateOpen(true)}
            >
              스킬 만들기
            </button>
          </div>
        </div>
      </header>

      <div id={panelId} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${activeTab}`} className={styles.panel}>
        {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
        <div className={styles.table} role="table" aria-label="스킬 목록">
          <div className={cx(styles.row, styles["row-head"])} role="row">
            <ColumnHeader column={COLUMNS[0]} sort={sort} onSort={(key) => setSort((current) => nextSkillSort(current, key))}>
              <SkillCheckbox
                checked={isAllSelected}
                label="표시된 스킬 전체 선택"
                disabled={visibleSkills.length === 0}
                onChange={(checked) => setSelectedIds(checked ? new Set(visibleSkills.map((skill) => skill.id)) : new Set())}
              />
            </ColumnHeader>
            {COLUMNS.slice(1).map((column) => (
              <ColumnHeader key={column.label} column={column} sort={sort} onSort={(key) => setSort((current) => nextSkillSort(current, key))} />
            ))}
            <span className={styles["col-more"]} aria-hidden />
          </div>

          {catalog.isLoading && <p className={styles.message} role="status">스킬 목록을 불러오는 중입니다.</p>}
          {!catalog.isLoading && catalog.loadError == null && visibleSkills.length === 0 && (
            <p className={styles.message}>
              {catalog.skills.length === 0 ? "등록된 스킬이 없습니다." : "조건에 맞는 스킬이 없습니다."}
            </p>
          )}

          {visibleSkills.map((skill) => {
            const command = skillCommand(skill);
            const isEditing = editingId === skill.id;
            const isMenuOpen = openMenuId === skill.id;
            return (
              <div key={skill.id} role="rowgroup">
                <div className={styles.row} role="row">
                  <div className={cx(styles.cell, styles["col-command"])} role="cell">
                    <SkillCheckbox
                      checked={selectedIds.has(skill.id)}
                      label={`${command} 선택`}
                      onChange={(checked) => toggleSelected(skill.id, checked)}
                    />
                    <button
                      type="button"
                      className={styles.command}
                      aria-expanded={isEditing}
                      onClick={() => (isEditing ? setEditingId(null) : openEditor(skill))}
                    >
                      {command}
                    </button>
                  </div>
                  <div className={cx(styles.cell, styles["col-description"], styles.description)} role="cell">
                    {skillDescription(skill)}
                  </div>
                  <div className={cx(styles.cell, styles["col-scope"])} role="cell">
                    <span className={styles.scope}>{isPersonalSkill(skill) ? "개인" : "팀"}</span>
                  </div>
                  {/* 사용 상태: 실행(Figma 1482:10981). 스킬은 항상 사용 상태다. */}
                  <div className={cx(styles.cell, styles["col-state"])} role="cell">
                    <button type="button" className={styles.run} onClick={() => onRunSkill(skill)}>실행</button>
                  </div>
                  <div className={styles["col-more"]} role="cell" ref={isMenuOpen ? menuRef : undefined}>
                    <button
                      type="button"
                      className={styles["more-button"]}
                      aria-label={`${command} 더보기`}
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      onClick={() => setOpenMenuId(isMenuOpen ? null : skill.id)}
                    >
                      <SkillMoreIcon />
                    </button>
                    {isMenuOpen && (
                      <div className={styles.menu} role="menu">
                        <button type="button" role="menuitem" onClick={() => {
                          setOpenMenuId(null);
                          if (isEditing) setEditingId(null);
                          else openEditor(skill);
                        }}>
                          {isEditing ? "수정 닫기" : "수정"}
                        </button>
                        <button type="button" role="menuitem" className={styles["is-danger"]} onClick={() => {
                          setOpenMenuId(null);
                          deleteMutation.reset();
                          setDeleteTarget(skill);
                        }}>
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className={styles.editor}>
                    <label htmlFor={`${idPrefix}-${skill.id}-description`}>설명</label>
                    <textarea
                      id={`${idPrefix}-${skill.id}-description`}
                      rows={2}
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                    <label htmlFor={`${idPrefix}-${skill.id}-instructions`}>실행 지침</label>
                    <textarea
                      id={`${idPrefix}-${skill.id}-instructions`}
                      rows={6}
                      value={draft.instructionsMarkdown}
                      onChange={(event) => setDraft({ ...draft, instructionsMarkdown: event.target.value })}
                    />
                    {updateMutation.isError && (
                      <p className={styles.error} role="alert">
                        {getErrorMessage(updateMutation.error, "스킬 정의를 수정하지 못했습니다.")}
                      </p>
                    )}
                    <div className={styles["editor-actions"]}>
                      <button type="button" className={styles["secondary-button"]} onClick={() => setEditingId(null)}>취소</button>
                      <button
                        type="button"
                        className={styles["primary-button"]}
                        disabled={updateMutation.isPending}
                        onClick={() => saveDraft(skill)}
                      >
                        {updateMutation.isPending ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <dialog
        ref={deleteDialogRef}
        className={styles["delete-dialog"]}
        aria-labelledby={`${idPrefix}-delete-title`}
        onCancel={(event) => {
          // Escape는 레이어 스택이 처리한다. 브라우저 기본 닫기는 막고 상태로만 닫는다.
          event.preventDefault();
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
      >
        <h2 id={`${idPrefix}-delete-title`}>스킬을 삭제하시겠습니까?</h2>
        <p>「/{deleteTarget?.slug}」 스킬과 저장된 버전이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
        {deleteMutation.isError && (
          <p className={styles.error} role="alert">{getErrorMessage(deleteMutation.error, "스킬을 삭제하지 못했습니다.")}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" autoFocus disabled={deleteMutation.isPending}
            onClick={() => setDeleteTarget(null)}>취소</button>
          <button type="button" className="modal-delete-button" disabled={deleteMutation.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteMutation.mutate(deleteTarget, {
                onSuccess: () => {
                  toggleSelected(deleteTarget.id, false);
                  setEditingId((current) => (current === deleteTarget.id ? null : current));
                  setDeleteTarget(null);
                }
              });
            }}>{deleteMutation.isPending ? "삭제 중…" : "삭제"}</button>
        </div>
      </dialog>

      {isCreateOpen && workspaceId != null && (
        <SkillCreateSheet workspaceId={workspaceId} onClose={() => setIsCreateOpen(false)} onPublished={() => void catalog.refresh()} />
      )}
      {isSearchOpen && (
        <SkillSearchModal
          skills={catalog.skills}
          onSelect={(skill) => setSearchText(skill.slug)}
          onClose={() => setIsSearchOpen(false)}
        />
      )}
    </section>
  );
}
