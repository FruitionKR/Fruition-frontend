"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import {
  buildWorkspaceModelOptions,
  filterWorkspaceAiModels,
  getAiModelLockMessage,
  getProviderLabel,
  hasWorkspaceExcludedModels,
  isProviderLocked,
  isSameSelection,
  LOCKED_AI_MODELS,
  resolveWorkspaceModelSelection,
  type AiModel,
  type AiModelSelection
} from "@/entities/ai";
import { renameWorkspace, updateWorkspaceAutoIngest, useSelectedWorkspace, useWorkspaceRole } from "@/entities/workspace";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { claudeIcon, geminiIcon, gptIcon, SvgIcon, type SvgAsset } from "@/shared/ui/SvgIcon";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import panelStyles from "./WorkspacePanel.module.css";
import { WorkspaceIconSettings } from "./WorkspaceIconSettings";

// provider id → 아이콘
const providerIcons: Record<string, SvgAsset> = {
  openai: gptIcon,
  gemini: geminiIcon,
  claude: claudeIcon
};

interface WorkspacePanelProps {
  wsName: string;
  aiModels: AiModel[];
  aiModelSelection: AiModelSelection | null;
  aiModelError: string | null;
  isAiModelSaving: boolean;
  canUpdateAiModel: boolean;
  onSelectModel: (model: AiModel) => void;
}

/** 워크스페이스 설정 패널 (Figma 771:18800). */
export function WorkspacePanel({
  wsName,
  aiModels,
  aiModelSelection,
  aiModelError,
  isAiModelSaving,
  canUpdateAiModel,
  onSelectModel
}: WorkspacePanelProps) {
  // "모델 변경" 클릭 시에만 provider 선택 목록을 펼친다.
  const [isProviderListOpen, setIsProviderListOpen] = useState(false);
  // provider 클릭은 모델 목록만 바꿔 보여 주고, 저장은 모델을 고를 때 한다.
  const [viewingProvider, setViewingProvider] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const [nameInput, setNameInput] = useState(wsName);
  const [isNameSaving, setIsNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

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
  const canSaveName = trimmedName.length > 0 && trimmedName.length <= 65 && trimmedName !== wsName && !isNameSaving;

  async function saveWorkspaceName() {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId || !canSaveName) return;
    setIsNameSaving(true);
    setNameError(null);
    try {
      await renameWorkspace(workspaceId, trimmedName);
      // 서버에 저장된 정규화 값(trim)으로 입력창을 맞춘다.
      setNameInput(trimmedName);
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
  const providers = Array.from(new Set(modelOptions.map((model) => model.provider)));
  const selectedIcon = shownSelection ? providerIcons[shownSelection.provider] : undefined;
  // 표시 중인 provider가 목록에 없으면 첫 provider를 보여 준다(빈 목록 방지).
  const savedProvider =
    shownSelection && providers.includes(shownSelection.provider) ? shownSelection.provider : null;
  const activeProvider = viewingProvider ?? savedProvider ?? providers[0] ?? null;
  const providerModels = modelOptions.filter((model) => model.provider === activeProvider);

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="워크스페이스 설정" description="워크스페이스 설정입니다." />

      <div className={styles.section}>
        <SettingsSectionHeader>워크스페이스 이름</SettingsSectionHeader>
        <div className={styles.field}>
          <label htmlFor="workspace-name">워크스페이스 이름</label>
          <small>워크스페이스 이름은 최대 65자까지 입력할 수 있습니다.</small>
          <div className={panelStyles["name-edit"]}>
            <input
              id="workspace-name"
              type="text"
              maxLength={65}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveWorkspaceName();
              }}
            />
            <button type="button" className={styles.btn} disabled={!canSaveName} onClick={() => void saveWorkspaceName()}>
              {isNameSaving ? "저장 중…" : "저장"}
            </button>
          </div>
          {nameError && (
            <small className={styles["model-error"]} role="alert">
              {nameError}
            </small>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>워크스페이스 아이콘</SettingsSectionHeader>
        <WorkspaceIconSettings />
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
            {!isOwner && <small className={styles["provider-readonly"]}>이 설정은 워크스페이스 OWNER만 바꿀 수 있습니다.</small>}
            {autoIngestError && (
              <small className={styles["model-error"]} role="alert">
                {autoIngestError}
              </small>
            )}
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

      <div className={styles.section}>
        <SettingsSectionHeader>AI 모델</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>LLM Provider</strong>
            <small>위키 생성•편집에 사용하는 모델</small>
            {hasExcludedModels && <small>Claude 모델은 채팅에서 직접 선택할 때만 사용할 수 있습니다.</small>}
          </div>
          <div className={panelStyles["model-controls"]}>
            <div className={panelStyles["model-actions"]}>
              {shownSelection && (
                <span className={panelStyles.pill}>
                  {selectedIcon && <SvgIcon src={selectedIcon} className={panelStyles["pill-icon"]} />}
                  {getProviderLabel(shownSelection.provider)} • {shownSelection.model}
                </span>
              )}
              <button
                type="button"
                className={styles.btn}
                disabled={!canUpdateAiModel}
                aria-expanded={isProviderListOpen}
                onClick={() => setIsProviderListOpen((open) => !open)}
              >
                모델 변경
              </button>
            </div>
            {!canUpdateAiModel && (
              <small className={styles["provider-readonly"]}>
                Provider 변경은 워크스페이스 OWNER만 할 수 있습니다.
              </small>
            )}
            {isSelectionFallback && (
              <small className={styles["provider-readonly"]}>
                저장된 모델을 더 이상 사용할 수 없어 기본 모델로 처리합니다.
              </small>
            )}
            {isProviderListOpen && canUpdateAiModel && (
              <>
                {workspaceModels.length === 0 && (
                  <small className={styles["provider-readonly"]}>사용할 수 있는 모델이 없습니다.</small>
                )}
                <div className={styles["provider-list"]}>
                  {providers.map((provider) => {
                    const icon = providerIcons[provider];
                    const isActive = activeProvider === provider;
                    // 모델이 모두 잠긴 provider(Claude)도 눌러서 잠긴 모델을 볼 수 있다. 자물쇠로 쓸 수 없음을 알린다.
                    const isLocked = isProviderLocked(modelOptions.filter((model) => model.provider === provider));
                    return (
                      <button
                        key={provider}
                        type="button"
                        className={`${styles["provider-button"]} ${isActive ? styles["is-selected"] : ""} ${isLocked ? panelStyles["is-locked"] : ""}`}
                        aria-pressed={isActive}
                        disabled={isAiModelSaving}
                        onClick={() => setViewingProvider(provider)}
                      >
                        {icon && <SvgIcon src={icon} className={styles["provider-icon"]} />}
                        <span className={panelStyles["provider-name"]}>
                          {getProviderLabel(provider)}
                          {isLocked && <Lock size={11} aria-label="사용 불가" role="img" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {providerModels.length > 0 && (
                  <div
                    className={panelStyles["model-list"]}
                    role="group"
                    aria-label={`${getProviderLabel(activeProvider ?? "")} 모델`}
                  >
                    {providerModels.map((model) => {
                      const isSelected = isSameSelection(model, shownSelection);
                      const lockMessage = model.lockReason ? getAiModelLockMessage(model.lockReason) : null;
                      return (
                        <button
                          key={model.model}
                          type="button"
                          className={`${panelStyles["model-option"]} ${isSelected ? panelStyles["is-selected"] : ""} ${lockMessage ? panelStyles["is-locked"] : ""}`}
                          aria-pressed={isSelected}
                          aria-disabled={lockMessage ? true : undefined}
                          title={lockMessage ?? undefined}
                          disabled={isAiModelSaving}
                          // 잠긴 모델은 포커스는 받지만 고를 수 없다.
                          onClick={() => {
                            if (!lockMessage) onSelectModel(model);
                          }}
                        >
                          <span className={panelStyles["model-option-text"]}>
                            <span>{model.display_name}</span>
                            <small>{lockMessage ?? model.model}</small>
                          </span>
                          {isSelected && <Check size={12} aria-hidden />}
                          {lockMessage && <Lock size={12} aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {aiModelError && (
              <small className={styles["model-error"]} role="alert">
                {aiModelError}
              </small>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
