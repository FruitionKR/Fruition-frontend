"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildWorkspaceModelOptions,
  filterWorkspaceAiModels,
  hasWorkspaceExcludedModels,
  LOCKED_AI_MODELS,
  resolveWorkspaceModelSelection,
  type AiModel,
  type AiModelSelection
} from "@/entities/ai";
import { useUserPreferences } from "@/entities/user";
import { renameWorkspace, updateWorkspaceAutoIngest, useSelectedWorkspace, useWorkspaceRole } from "@/entities/workspace";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { WorkspaceIconSettings } from "./WorkspaceIconSettings";
import { WorkspaceModelMenu } from "./WorkspaceModelMenu";

/** 워크스페이스 이름 최대 길이 (서버 제한과 같다) */
const WORKSPACE_NAME_MAX_LENGTH = 65;

interface WorkspacePanelProps {
  wsName: string;
  aiModels: AiModel[];
  aiModelSelection: AiModelSelection | null;
  aiModelError: string | null;
  isAiModelSaving: boolean;
  canUpdateAiModel: boolean;
  onSelectModel: (model: AiModel) => void;
}

/**
 * 워크스페이스 설정 (Figma 1511:14771, 모델 메뉴 1691:17420).
 * 이름 · 아이콘 + 자동 저장 · AI 모델. 자동 저장은 디스플레이(기본 설정)에 있던 개인 설정을 시안대로 이 화면으로 옮겼다.
 * 위키 자동 편입은 시안에 없지만 다른 진입점이 없어 맨 아래에 남긴다. 시안의 튜토리얼 다시보기는 튜토리얼 기능이 없어 넣지 않았다.
 */
export function WorkspacePanel({
  wsName,
  aiModels,
  aiModelSelection,
  aiModelError,
  isAiModelSaving,
  canUpdateAiModel,
  onSelectModel
}: WorkspacePanelProps) {
  const queryClient = useQueryClient();
  const { preferences, updatePreferences } = useUserPreferences();
  const [nameInput, setNameInput] = useState(wsName);
  const [isNameSaving, setIsNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // 업로드 자동 편입 설정(access #32). 워크스페이스 목록 응답의 값을 보여 주고, OWNER만 바꾼다.
  const workspace = useSelectedWorkspace();
  const { isOwner } = useWorkspaceRole();
  const autoIngestOnUpload = workspace?.auto_ingest_on_upload === true;
  const [isAutoIngestSaving, setIsAutoIngestSaving] = useState(false);
  const [autoIngestError, setAutoIngestError] = useState<string | null>(null);

  async function toggleAutoIngest() {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId || !isOwner || isAutoIngestSaving) return;
    setIsAutoIngestSaving(true);
    setAutoIngestError(null);
    try {
      await updateWorkspaceAutoIngest(workspaceId, !autoIngestOnUpload);
      // useSelectedWorkspace가 새 설정값을 읽도록 목록 캐시를 무효화한다.
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (error: unknown) {
      setAutoIngestError(getErrorMessage(error, "자동 편입 설정을 변경하지 못했습니다."));
    } finally {
      setIsAutoIngestSaving(false);
    }
  }

  // 워크스페이스 목록이 늦게 로드되면 초기값을 따라잡는다(사용자가 편집 중이 아닐 때만).
  useEffect(() => {
    setNameInput((current) => (current === "" || current === "워크스페이스" ? wsName : current));
  }, [wsName]);

  const trimmedName = nameInput.trim();
  const canSaveName = trimmedName.length > 0 && trimmedName.length <= WORKSPACE_NAME_MAX_LENGTH && trimmedName !== wsName && !isNameSaving;

  /** 시안에는 저장 버튼이 없어 Enter·포커스 이탈 때 저장한다(닉네임과 같은 방식). */
  async function saveWorkspaceName() {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return;
    if (!trimmedName) {
      setNameSaved(false);
      setNameError("워크스페이스 이름을 입력해 주세요.");
      return;
    }
    if (!canSaveName) return;
    setIsNameSaving(true);
    setNameError(null);
    setNameSaved(false);
    try {
      await renameWorkspace(workspaceId, trimmedName);
      // 서버에 저장된 정규화 값(trim)으로 입력창을 맞춘다.
      setNameInput(trimmedName);
      setNameSaved(true);
      // 사이드바 등 useWorkspaceName 소비처가 새 이름을 반영하도록 캐시를 무효화한다.
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (error: unknown) {
      setNameError(getErrorMessage(error, "워크스페이스 이름을 변경하지 못했습니다."));
    } finally {
      setIsNameSaving(false);
    }
  }

  // 워크스페이스 공용 모델에는 Claude를 쓸 수 없으므로 선택 가능한 모델은 카탈로그에서 Claude를 뺀 목록이다.
  const workspaceModels = filterWorkspaceAiModels(aiModels);
  // 화면에는 Claude·정책으로 빠진 모델도 잠금으로 함께 보여 준다.
  const modelOptions = buildWorkspaceModelOptions(aiModels, LOCKED_AI_MODELS);
  const hasExcludedModels = hasWorkspaceExcludedModels(aiModels);
  // 저장값이 Claude이거나 카탈로그에서 빠졌으면 백엔드처럼 기본 모델로 대체해 보여 준다.
  const { selection: shownSelection, isFallback: isSelectionFallback } = resolveWorkspaceModelSelection(
    workspaceModels,
    aiModelSelection
  );

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="워크스페이스 설정" description="워크스페이스 설정입니다." />

      <div className={styles.section}>
        <SettingsSectionHeader>워크스페이스 이름</SettingsSectionHeader>
        <div className={styles.field}>
          <label htmlFor="workspace-name">워크스페이스 이름</label>
          <small id="workspace-name-hint">워크스페이스 이름은 최대 {WORKSPACE_NAME_MAX_LENGTH}자까지 입력할 수 있습니다.</small>
          <input
            id="workspace-name"
            type="text"
            className={styles["is-filled"]}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            value={nameInput}
            aria-describedby={nameError ? "workspace-name-hint workspace-name-error" : "workspace-name-hint"}
            aria-invalid={nameError ? true : undefined}
            onChange={(event) => { setNameInput(event.target.value); setNameError(null); setNameSaved(false); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void saveWorkspaceName();
            }}
            onBlur={() => void saveWorkspaceName()}
          />
          {nameError && <small id="workspace-name-error" className={styles["field-error"]} role="alert">{nameError}</small>}
          {isNameSaving ? <small role="status">저장 중…</small> : nameSaved && <small role="status">워크스페이스 이름을 변경했습니다.</small>}
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>워크스페이스 아이콘</SettingsSectionHeader>
        <div className={styles["stack-20"]}>
          <WorkspaceIconSettings />
          <div className={styles.row}>
            <div className={styles["row-title"]}>
              <strong>자동 저장</strong>
              <small>편집한 내용을 자동으로 저장합니다.</small>
            </div>
            <Switch checked={preferences.autoSave} label="자동 저장"
              onClick={() => updatePreferences((current) => ({ ...current, autoSave: !current.autoSave }))} />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>AI 모델</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>LLM Provider</strong>
            <small>위키 생성•편집에 사용하는 모델</small>
            {hasExcludedModels && <small>Claude 모델은 채팅에서 직접 선택할 때만 사용할 수 있습니다.</small>}
            {!canUpdateAiModel && <small>Provider 변경은 워크스페이스 OWNER만 할 수 있습니다.</small>}
            {isSelectionFallback && <small>저장된 모델을 더 이상 사용할 수 없어 기본 모델로 처리합니다.</small>}
            {aiModelError && <small className={styles["row-error"]} role="alert">{aiModelError}</small>}
          </div>
          <WorkspaceModelMenu
            modelOptions={modelOptions}
            selection={shownSelection}
            canUpdate={canUpdateAiModel}
            isSaving={isAiModelSaving}
            onSelect={onSelectModel}
          />
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>위키 자동 편입</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>업로드한 문서를 자동으로 위키에 편입</strong>
            <small>
              문서를 올리면 변환 뒤 바로 팀 위키에 편입합니다. 편입은 LLM 비용이 들고,
              멤버 관리에서 &apos;위키 편입&apos; 권한을 받은 멤버가 올린 문서에만 적용됩니다.
            </small>
            {!isOwner && <small>이 설정은 워크스페이스 OWNER만 바꿀 수 있습니다.</small>}
            {autoIngestError && <small className={styles["row-error"]} role="alert">{autoIngestError}</small>}
          </div>
          <Switch
            checked={autoIngestOnUpload}
            label="업로드한 문서를 자동으로 위키에 편입"
            // 저장 중에 disabled로 바꾸면 스위치의 포커스가 body로 빠진다. 중복 요청은 toggleAutoIngest의 isAutoIngestSaving 검사가 막는다.
            disabled={!isOwner || !workspace}
            onClick={() => void toggleAutoIngest()}
          />
        </div>
      </div>
    </div>
  );
}
