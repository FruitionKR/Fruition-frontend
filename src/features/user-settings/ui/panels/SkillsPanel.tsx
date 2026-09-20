"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSkill,
  disableSkill,
  enableSkill,
  fetchSkills,
  updateSkill,
  type SkillResponse
} from "@/entities/skill";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { menuSearchIcon, settingScrollIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import modalStyles from "../SettingsModal.module.css";
import { SkillCreateWizard } from "./SkillCreateWizard";
import { SkillSearchModal } from "./SkillSearchModal";
import styles from "./SkillsPanel.module.css";



// 저장범위·상태 필터 순환 순서
const SCOPE_FILTERS = ["all", "personal", "team"] as const;
const STATE_FILTERS = ["all", "enabled", "disabled"] as const;
type ScopeFilter = (typeof SCOPE_FILTERS)[number];
type StateFilter = (typeof STATE_FILTERS)[number];

const SCOPE_LABELS: Record<ScopeFilter, string> = { all: "전체", personal: "개인", team: "팀" };
const STATE_LABELS: Record<StateFilter, string> = { all: "전체", enabled: "사용 중", disabled: "사용 안 함" };

/** 자동 선택은 서버 상태가 enabled이고 게시된 버전이 있을 때만 켜진다. */
function isSkillEnabled(skill: SkillResponse): boolean {
  return skill.status === "enabled" && skill.enabled_version != null;
}

function skillLabel(skill: SkillResponse): { command: string; description: string } {
  const version = skill.enabled_version ?? skill.latest_version;
  return {
    command: `/${skill.slug}`,
    description: version?.description ?? ""
  };
}

/** 인라인 편집 폼 상태 */
interface EditDraft {
  description: string;
  instructionsMarkdown: string;
}

/** 스킬 패널 (Figma 981:10091). 목록·토글·작성(author/publish)·수정(PATCH)·필터·검색 배선. */
export function SkillsPanel() {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  // 워크스페이스별 캐시 분리 (documents 쿼리 키 관례와 동일)
  const SKILLS_QUERY_KEY = ["skills", workspaceId] as const;
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<SkillResponse | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (deleteTarget) deleteDialogRef.current?.showModal();
    else deleteDialogRef.current?.close();
  }, [deleteTarget]);

  // 필터·검색 상태 (전부 클라이언트 필터링)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  // 열려 있는 필터 드롭다운 (한 번에 하나만)
  const [openMenu, setOpenMenu] = useState<"scope" | "state" | null>(null);
  const [searchText, setSearchText] = useState("");

  // 새 스킬 만들기 위저드 열림 상태
  const [createOpen, setCreateOpen] = useState(false);

  // 행 인라인 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ description: "", instructionsMarkdown: "" });
  const [editError, setEditError] = useState<string | null>(null);

  const { data: skills, isLoading, error } = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: () => fetchSkills(workspaceId ?? ""),
    enabled: workspaceId != null
  });

  const filteredSkills = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return (skills ?? []).filter((skill) => {
      if (scopeFilter === "personal" && skill.scope_type !== "personal") return false;
      if (scopeFilter === "team" && skill.scope_type === "personal") return false;
      if (stateFilter === "enabled" && !isSkillEnabled(skill)) return false;
      if (stateFilter === "disabled" && isSkillEnabled(skill)) return false;
      if (keyword.length > 0) {
        const { description } = skillLabel(skill);
        const haystack = `${skill.slug} ${description}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [skills, scopeFilter, stateFilter, searchText]);

  const toggleMutation = useMutation({
    mutationFn: ({ skill }: { skill: SkillResponse }) =>
      isSkillEnabled(skill)
        ? disableSkill(workspaceId ?? "", skill.id)
        : enableSkill(workspaceId ?? "", skill.id),
    onSuccess: (updated) => {
      setToggleError(null);
      // 서버 응답으로 해당 행만 교체해 목록 재조회를 생략한다.
      queryClient.setQueryData<SkillResponse[]>(SKILLS_QUERY_KEY, (current) =>
        current?.map((skill) => (skill.id === updated.id ? updated : skill))
      );
    },
    onError: (mutationError: unknown) => {
      setToggleError(getErrorMessage(mutationError, "스킬 사용 상태를 변경하지 못했습니다."));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ skill }: { skill: SkillResponse }) =>
      updateSkill(workspaceId ?? "", skill.id, {
        description: editDraft.description,
        instructions_markdown: editDraft.instructionsMarkdown
      }),
    onSuccess: (result, { skill }) => {
      setEditError(null);
      // 저장 중 다른 스킬 편집으로 전환했을 수 있으니, 저장한 스킬의 편집 상태만 닫는다.
      setEditingId((current) => (current === skill.id ? null : current));
      // PATCH 응답 필드로 캐시 행의 버전 정보를 교체한다.
      queryClient.setQueryData<SkillResponse[]>(SKILLS_QUERY_KEY, (current) =>
        current?.map((item) => {
          if (item.id !== skill.id) return item;
          const patchVersion = (version: SkillResponse["latest_version"]) =>
            version == null
              ? version
              : {
                  ...version,
                  name: result.name,
                  description: result.description,
                  instructions_markdown: result.instructions_markdown
                };
          return {
            ...item,
            enabled_version: patchVersion(item.enabled_version),
            latest_version: patchVersion(item.latest_version)
          };
        })
      );
    },
    onError: (mutationError: unknown) => {
      setEditError(getErrorMessage(mutationError, "스킬 정의를 수정하지 못했습니다."));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (skill: SkillResponse) => deleteSkill(workspaceId ?? "", skill.id),
    onSuccess: (_, skill) => {
      queryClient.setQueryData<SkillResponse[]>(SKILLS_QUERY_KEY, (current) =>
        current?.filter((item) => item.id !== skill.id)
      );
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(skill.id);
        return next;
      });
      setEditingId((current) => current === skill.id ? null : current);
      setDeleteTarget(null);
    }
  });

  function openEditForm(skill: SkillResponse) {
    const version = skill.enabled_version ?? skill.latest_version;
    setEditingId(skill.id);
    setEditError(null);
    setEditDraft({
      description: version?.description ?? "",
      instructionsMarkdown: version?.instructions_markdown ?? ""
    });
  }

  return (
    <div className={modalStyles.detail}>
      <div className={modalStyles.title}>
        <div className={modalStyles["title-row"]}>
          <h2>스킬</h2>
        </div>
        <p>반복 작업을 안전한 실행 규칙으로 만들어 Fruition Agent에서 재사용합니다.</p>
      </div>

      {/* 필터·검색·생성 툴바 */}
      <div className={styles.toolbar}>
        <div className={styles["toolbar-group"]}>
          <div className={styles["filter-wrap"]}>
            <button
              type="button"
              className={styles["filter-btn"]}
              aria-expanded={openMenu === "scope"}
              onClick={() => setOpenMenu(openMenu === "scope" ? null : "scope")}
            >
              {scopeFilter === "all" ? (
                <>저장범위 : 전체</>
              ) : (
                <span className={styles["filter-accent"]}>저장범위 : {SCOPE_LABELS[scopeFilter]}</span>
              )}
              <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
            </button>
            {openMenu === "scope" && (
              <div className={styles["filter-menu"]} role="listbox" aria-label="저장범위 선택">
                {SCOPE_FILTERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={scopeFilter === option}
                    className={`${styles["filter-option"]} ${scopeFilter === option ? styles["is-selected"] : ""}`}
                    onClick={() => {
                      setScopeFilter(option);
                      setOpenMenu(null);
                    }}
                  >
                    {SCOPE_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles["filter-wrap"]}>
            <button
              type="button"
              className={styles["filter-btn"]}
              aria-expanded={openMenu === "state"}
              onClick={() => setOpenMenu(openMenu === "state" ? null : "state")}
            >
              {stateFilter === "all" ? (
                <>상태</>
              ) : (
                <span className={styles["filter-accent"]}>상태 : {STATE_LABELS[stateFilter]}</span>
              )}
              <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
            </button>
            {openMenu === "state" && (
              <div className={styles["filter-menu"]} role="listbox" aria-label="상태 선택">
                {STATE_FILTERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={stateFilter === option}
                    className={`${styles["filter-option"]} ${stateFilter === option ? styles["is-selected"] : ""}`}
                    onClick={() => {
                      setStateFilter(option);
                      setOpenMenu(null);
                    }}
                  >
                    {STATE_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={styles["toolbar-group"]}>
          {searchText && (
            <button
              type="button"
              className={styles["filter-btn"]}
              aria-label="스킬 검색 해제"
              onClick={() => setSearchText("")}
            >
              <span className={styles["filter-accent"]}>검색 : {searchText}</span>
              <span aria-hidden>✕</span>
            </button>
          )}
          <button
            type="button"
            className={styles["search-btn"]}
            aria-label="스킬 검색"
            onClick={() => setSearchOpen(true)}
          >
            <SvgIcon src={menuSearchIcon} className={styles["search-icon"]} />
          </button>
          <button
            type="button"
            className={styles["create-btn"]}
            disabled={workspaceId == null}
            onClick={() => setCreateOpen(true)}
          >
            새 스킬 만들기 <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
          </button>
        </div>
      </div>

      {error != null && (
        <small className={modalStyles["model-error"]} role="alert">
          {getErrorMessage(error, "스킬 목록을 불러오지 못했습니다.")}
        </small>
      )}
      {toggleError && (
        <small className={modalStyles["model-error"]} role="alert">
          {toggleError}
        </small>
      )}

      {/* 스킬 테이블 */}
      <div className={styles.table}>
        <div className={`${styles.row} ${styles["row-head"]}`}>
          <input
            type="checkbox"
            className={styles.checkbox}
            aria-label="표시된 스킬 전체 선택"
            checked={filteredSkills.length > 0 && filteredSkills.every((skill) => selectedIds.has(skill.id))}
            disabled={deleteMutation.isPending || filteredSkills.length === 0}
            onChange={(event) => setSelectedIds(event.target.checked
              ? new Set(filteredSkills.map((skill) => skill.id)) : new Set())}
          />
          <span>커맨드</span>
          <span>설명</span>
          <span className={styles["cell-scope"]}>저장 범위</span>
          <span className={styles["cell-state"]}>사용 상태</span>
        </div>
        {isLoading && <p className={styles.empty}>스킬 목록을 불러오는 중…</p>}
        {!isLoading && error == null && filteredSkills.length === 0 && (
          <p className={styles.empty}>
            {(skills?.length ?? 0) === 0 ? "등록된 스킬이 없습니다." : "조건에 맞는 스킬이 없습니다."}
          </p>
        )}
        {filteredSkills.map((skill) => {
          const { command, description } = skillLabel(skill);
          const enabled = isSkillEnabled(skill);
          const isEditing = editingId === skill.id;
          return (
            <div key={skill.id}>
              <div className={styles.row}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  aria-label={`${command} 삭제 선택`}
                  checked={selectedIds.has(skill.id)}
                  disabled={deleteMutation.isPending}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(skill.id);
                      else next.delete(skill.id);
                      return next;
                    });
                  }}
                />
                <button
                  type="button"
                  className={styles.command}
                  disabled={updateMutation.isPending}
                  onClick={() => (isEditing ? setEditingId(null) : openEditForm(skill))}
                >
                  {command}
                </button>
                <span className={styles.description}>{description}</span>
                <span className={styles["cell-scope"]}>
                  <span className={styles["scope-chip"]}>
                    {skill.scope_type === "personal" ? "개인" : "팀"}
                  </span>
                </span>
                <span className={styles["cell-state"]}>
                  {selectedIds.has(skill.id) ? (
                    <button
                      type="button"
                      className={styles["delete-btn"]}
                      aria-label={`${command} 삭제`}
                      disabled={deleteMutation.isPending || toggleMutation.isPending || updateMutation.isPending}
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleteTarget(skill);
                      }}
                    >
                      <Trash2 size={20} aria-hidden="true" />
                    </button>
                  ) : (
                  <button
                    type="button"
                    className={`${modalStyles.switch} ${enabled ? modalStyles["is-on"] : styles["is-off"]}`}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${command} 사용 상태`}
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ skill })}
                  >
                    <span className={modalStyles["switch-ball"]} />
                  </button>
                  )}
                </span>
              </div>

              {/* 인라인 정의 수정 영역 */}
              {isEditing && (
                <div className={styles["edit-form"]}>
                  <label className={styles["form-label"]} htmlFor={`edit-description-${skill.id}`}>설명</label>
                  <textarea
                    id={`edit-description-${skill.id}`}
                    className={styles["form-textarea"]}
                    rows={2}
                    value={editDraft.description}
                    onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
                  />
                  <label className={styles["form-label"]} htmlFor={`edit-instructions-${skill.id}`}>실행 지침</label>
                  <textarea
                    id={`edit-instructions-${skill.id}`}
                    className={styles["form-textarea"]}
                    rows={6}
                    value={editDraft.instructionsMarkdown}
                    onChange={(event) => setEditDraft({ ...editDraft, instructionsMarkdown: event.target.value })}
                  />
                  <div className={styles["form-actions"]}>
                    <button
                      type="button"
                      className={styles["form-primary"]}
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ skill })}
                    >
                      {updateMutation.isPending ? "저장 중…" : "저장"}
                    </button>
                    <button type="button" className={styles["form-secondary"]} onClick={() => setEditingId(null)}>
                      취소
                    </button>
                  </div>
                  {editError && (
                    <small className={modalStyles["model-error"]} role="alert">
                      {editError}
                    </small>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <dialog
        ref={deleteDialogRef}
        className={styles["delete-dialog"]}
        aria-labelledby="skill-delete-title"
        aria-describedby="skill-delete-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
      >
        <h2 id="skill-delete-title">스킬을 삭제하시겠습니까?</h2>
        <p id="skill-delete-description">
          「/{deleteTarget?.slug}」 스킬과 저장된 버전이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        {deleteMutation.isError && (
          <p role="alert">{getErrorMessage(deleteMutation.error, "스킬을 삭제하지 못했습니다.")}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" autoFocus disabled={deleteMutation.isPending}
            onClick={() => setDeleteTarget(null)}>취소</button>
          <button type="button" className="modal-delete-button" disabled={deleteMutation.isPending}
            onClick={() => {
              if (deleteTarget && !deleteMutation.isPending) deleteMutation.mutate(deleteTarget);
            }}>{deleteMutation.isPending ? "삭제 중…" : "삭제"}</button>
        </div>
      </dialog>

      {createOpen && workspaceId != null && (
        <SkillCreateWizard
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onPublished={() => queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY })}
        />
      )}

      {searchOpen && (
        <SkillSearchModal
          skills={skills ?? []}
          onSelect={(skill) => {
            // 선택한 스킬만 보이도록 검색 필터를 적용한다.
            setSearchText(skill.slug);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
