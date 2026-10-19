"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SkillResponse } from "@/entities/skill";
import { SkillCreateEditor, SkillDetailEditor } from "@/features/skill-authoring";
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
import {
  activateTab,
  closeTab,
  INITIAL_SKILL_EDITOR_TABS,
  openCreateTab,
  openCreateTabForRequest,
  openDetailTab,
  pruneDetailTabs,
  SKILL_LIST_TAB_ID,
  type SkillEditorTab
} from "../lib/skillEditorTabs";
import { useSkillCatalog } from "../model/useSkillCatalog";
import { SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "./SkillIcons";
import styles from "./SkillsView.module.css";

const TABS: { id: SkillTab; label: string }[] = [
  { id: "all", label: "전체 스킬" },
  { id: "team", label: "팀 스킬" },
  { id: "personal", label: "개인 스킬" }
];

/** Figma 1708:4528: 정렬 아이콘은 커맨드 열에만 있다. 저장범위는 탭으로 거른다. */
const COLUMNS: { label: string; className: string; sortKey?: SkillSortKey }[] = [
  { label: "커맨드", className: "col-command", sortKey: "command" },
  { label: "설명", className: "col-description" },
  { label: "저장범위", className: "col-scope" },
  { label: "사용 상태", className: "col-state" }
];

function ColumnHeader({ column, sort, onSort }: {
  column: (typeof COLUMNS)[number];
  sort: SkillSort;
  onSort: (key: SkillSortKey) => void;
}) {
  const { sortKey } = column;
  const direction = sortKey && sort?.key === sortKey ? sort.direction : null;
  return (
    <div
      className={cx(styles.cell, styles[column.className])}
      role="columnheader"
      aria-sort={sortKey ? (direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none") : undefined}
    >
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
 * 맨 위 탭 줄: '스킬'(목록) 탭 + 새 스킬·스킬 상세 편집 탭 + '+'(새 스킬). 디자인 '② 새 스킬 탭'.
 * 목록: 탭 = 저장범위 필터, 커맨드 머리글 = 정렬, 행 클릭·더보기 '수정' = 스킬 상세 탭,
 * 더보기 '삭제' = 삭제 확인, 실행 = 대상 문서 고르기(onRunSkill)로 넘어간다.
 * createRequest가 오면(작업 탭 "이 요청을 스킬로 저장") 그 요청으로 채운 새 스킬 탭을 한 번 열고 onCreateRequestHandled로 알린다.
 */
export function SkillsView({
  onRunSkill,
  createRequest = null,
  onCreateRequestHandled
}: {
  onRunSkill: (skill: SkillResponse) => void;
  createRequest?: { id: number; text: string } | null;
  onCreateRequestHandled?: (id: number) => void;
}) {
  const workspaceId = getSelectedWorkspaceId();
  const catalog = useSkillCatalog(workspaceId);
  const { updateMutation, deleteMutation } = catalog;
  const idPrefix = useId();

  const [activeTab, setActiveTab] = useState<SkillTab>("all");
  const [sort, setSort] = useState<SkillSort>(null);
  const [searchText, setSearchText] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [editorTabs, setEditorTabs] = useState(INITIAL_SKILL_EDITOR_TABS);
  useEffect(() => {
    if (!createRequest) return;
    setEditorTabs((current) => openCreateTabForRequest(current, createRequest.text));
    onCreateRequestHandled?.(createRequest.id);
  }, [createRequest, onCreateRequestHandled]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useDismissableMenu(openMenuId !== null, () => setOpenMenuId(null));
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

  // 상세 탭은 목록 캐시의 최신 스킬을 본다. 목록에서 사라지면(삭제 등) 그 탭을 닫는다.
  const isCatalogLoaded = !catalog.isLoading && catalog.loadError == null;
  useEffect(() => {
    if (!isCatalogLoaded) return;
    const skillIds = catalog.skills.map((skill) => skill.id);
    setEditorTabs((current) => pruneDetailTabs(current, skillIds));
  }, [isCatalogLoaded, catalog.skills]);

  function openDetail(skill: SkillResponse) {
    setOpenMenuId(null);
    updateMutation.reset();
    deleteMutation.reset();
    setEditorTabs((current) => openDetailTab(current, skill.id));
  }

  function openCreate() {
    setOpenMenuId(null);
    setEditorTabs((current) => openCreateTab(current));
  }

  const showList = () => setEditorTabs((current) => activateTab(current, SKILL_LIST_TAB_ID));
  const closeEditorTab = (id: string) => setEditorTabs((current) => closeTab(current, id));
  const tabDomId = (id: string) => `${idPrefix}-editor-tab-${id}`;
  const tabPanelDomId = (id: string) => `${idPrefix}-editor-panel-${id}`;
  const isListActive = editorTabs.activeId === SKILL_LIST_TAB_ID;

  function editorTabLabel(tab: SkillEditorTab): string {
    if (tab.kind === "create") return "새 스킬";
    const skill = catalog.skills.find((item) => item.id === tab.skillId);
    return skill ? `/${skill.slug}` : "스킬";
  }

  const panelId = `${idPrefix}-panel`;
  const errorMessage = catalog.loadError ?? catalog.actionError;

  return (
    <section className={styles.skills} aria-label="스킬">
      {/* 편집 탭 줄: 목록 '스킬' 탭은 늘 있다. 편집 탭은 닫기(×), 맨 끝 '+'는 새 스킬 탭이다. */}
      <div className={styles["editor-tab-bar"]}>
        <div role="tablist" aria-label="스킬 편집 탭" className={styles["editor-tab-list"]}>
          <div className={cx(styles["editor-tab"], isListActive && styles["is-active"])}>
            <button
              type="button"
              role="tab"
              id={tabDomId(SKILL_LIST_TAB_ID)}
              aria-selected={isListActive}
              aria-controls={tabPanelDomId(SKILL_LIST_TAB_ID)}
              className={styles["editor-tab-button"]}
              onClick={showList}
            >
              스킬
            </button>
          </div>
          {editorTabs.tabs.map((tab) => {
            const isActive = editorTabs.activeId === tab.id;
            const label = editorTabLabel(tab);
            return (
              <div key={tab.id} className={cx(styles["editor-tab"], isActive && styles["is-active"])}>
                <button
                  type="button"
                  role="tab"
                  id={tabDomId(tab.id)}
                  aria-selected={isActive}
                  aria-controls={tabPanelDomId(tab.id)}
                  className={styles["editor-tab-button"]}
                  title={label}
                  onClick={() => setEditorTabs((current) => activateTab(current, tab.id))}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className={styles["editor-tab-close"]}
                  aria-label={`${label} 탭 닫기`}
                  onClick={() => closeEditorTab(tab.id)}
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={styles["editor-tab-add"]}
          aria-label="새 스킬 탭 열기"
          disabled={workspaceId == null}
          onClick={openCreate}
        >
          <span aria-hidden>+</span>
        </button>
      </div>

      <div
        id={tabPanelDomId(SKILL_LIST_TAB_ID)}
        role="tabpanel"
        aria-labelledby={tabDomId(SKILL_LIST_TAB_ID)}
        hidden={!isListActive}
        className={styles["list-panel"]}
      >
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
                onClick={openCreate}
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
              {COLUMNS.map((column) => (
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
              const isMenuOpen = openMenuId === skill.id;
              return (
                <div key={skill.id} role="rowgroup">
                  {/* 행을 누르면 스킬 상세 시트가 열린다. 키보드는 더보기 '수정'으로 연다. */}
                  <div className={cx(styles.row, styles["is-clickable"])} role="row" onClick={() => openDetail(skill)}>
                    {/* 커맨드 (Figma 1708:4537): 일반 텍스트 */}
                    <div className={cx(styles.cell, styles["col-command"], styles.command)} role="cell" title={command}>
                      {command}
                    </div>
                    <div className={cx(styles.cell, styles["col-description"], styles.description)} role="cell">
                      {skillDescription(skill)}
                    </div>
                    <div className={cx(styles.cell, styles["col-scope"])} role="cell">
                      <span className={styles.scope}>{isPersonalSkill(skill) ? "개인" : "팀"}</span>
                    </div>
                    {/* 사용 상태: 실행(Figma 1482:10981). 스킬은 항상 사용 상태다. */}
                    <div className={cx(styles.cell, styles["col-state"])} role="cell">
                      <button type="button" className={styles.run} onClick={(event) => {
                        event.stopPropagation();
                        onRunSkill(skill);
                      }}>실행</button>
                    </div>
                    <div
                      className={styles["col-more"]}
                      role="cell"
                      ref={isMenuOpen ? menuRef : undefined}
                      onClick={(event) => event.stopPropagation()}
                    >
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
                          <button type="button" role="menuitem" onClick={() => openDetail(skill)}>
                            수정
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
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 편집 탭 본문. 다른 탭을 보는 동안에도 입력이 남도록 닫을 때까지 마운트해 둔다. */}
      {workspaceId != null &&
        editorTabs.tabs.map((tab) => {
          const isActive = editorTabs.activeId === tab.id;
          const panelProps = {
            id: tabPanelDomId(tab.id),
            role: "tabpanel",
            "aria-labelledby": tabDomId(tab.id),
            hidden: !isActive,
            className: styles["editor-panel"]
          } as const;
          if (tab.kind === "create") {
            return (
              <div key={tab.id} {...panelProps}>
                <SkillCreateEditor
                  workspaceId={workspaceId}
                  prefillRequest={tab.prefillRequest}
                  onClose={() => closeEditorTab(tab.id)}
                  onShowList={showList}
                  onPublished={() => void catalog.refresh()}
                />
              </div>
            );
          }
          const skill = catalog.skills.find((item) => item.id === tab.skillId);
          if (!skill) return null;
          return (
            <div key={tab.id} {...panelProps}>
              <SkillDetailEditor
                workspaceId={workspaceId}
                skill={skill}
                onClose={() => closeEditorTab(tab.id)}
                onShowList={showList}
                onSubmit={(draft) => updateMutation.mutateAsync({ skill, draft })}
                onDelete={() => deleteMutation.mutateAsync(skill)}
              />
            </div>
          );
        })}

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
                onSuccess: () => setDeleteTarget(null)
              });
            }}>{deleteMutation.isPending ? "삭제 중…" : "삭제"}</button>
        </div>
      </dialog>

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
