"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
import { renameWorkspace, updateWorkspaceAutoIngest, updateWorkspaceDescribePdfFigures, useSelectedWorkspace, useWorkspaceRole, type AutoIngestSettingField, type WorkspaceResponse } from "@/entities/workspace";
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
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const { preferences, updatePreferences } = useUserPreferences();
  const [nameInput, setNameInput] = useState(wsName);
  const [isNameSaving, setIsNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // 위키 자동 편입 설정(access #32). 워크스페이스 목록 응답의 값을 보여 주고, OWNER만 바꾼다.
  // 새 서버는 Markdown 업로드·PDF 변환 설정을 따로 주므로 스위치 두 개를 두고, 구 서버는 하나짜리 설정만 보여 준다.
  const workspace = useSelectedWorkspace();
  const { isOwner } = useWorkspaceRole();
  const autoIngestRows = autoIngestSettingRows(workspace);
  const [savingAutoIngestField, setSavingAutoIngestField] = useState<AutoIngestSettingField | null>(null);
  const [autoIngestError, setAutoIngestError] = useState<{ field: AutoIngestSettingField; message: string } | null>(null);

  async function toggleAutoIngest(field: AutoIngestSettingField, enabled: boolean) {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId || !isOwner || savingAutoIngestField) return;
    setSavingAutoIngestField(field);
    setAutoIngestError(null);
    try {
      await updateWorkspaceAutoIngest(workspaceId, field, enabled);
      // useSelectedWorkspace가 새 설정값을 읽도록 목록 캐시를 무효화한다.
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (error: unknown) {
      setAutoIngestError({ field, message: getErrorMessage(error, t("workspace.autoIngest.saveFailed")) });
    } finally {
      setSavingAutoIngestField(null);
    }
  }

  // PDF 그림 설명(외부 AI 전송). 비용·외부 전송이 생겨 기본은 끄고, 자동 편입처럼 OWNER만 바꾼다.
  const describePdfFigures = workspace?.describe_pdf_figures === true;
  const [isDescribeFiguresSaving, setIsDescribeFiguresSaving] = useState(false);
  const [describeFiguresError, setDescribeFiguresError] = useState<string | null>(null);

  async function toggleDescribePdfFigures() {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId || !isOwner || isDescribeFiguresSaving) return;
    setIsDescribeFiguresSaving(true);
    setDescribeFiguresError(null);
    try {
      await updateWorkspaceDescribePdfFigures(workspaceId, !describePdfFigures);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (error: unknown) {
      setDescribeFiguresError(getErrorMessage(error, t("workspace.describeFigures.saveFailed")));
    } finally {
      setIsDescribeFiguresSaving(false);
    }
  }

  // 워크스페이스 목록이 늦게 로드되면 초기값을 따라잡는다(사용자가 편집 중이 아닐 때만).
  const workspaceFallback = t("common.workspaceFallback");
  useEffect(() => {
    setNameInput((current) => (current === "" || current === workspaceFallback ? wsName : current));
    // 대체 이름(workspaceFallback)이 바뀌었다고 입력을 다시 맞추지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsName]);

  const trimmedName = nameInput.trim();
  const canSaveName = trimmedName.length > 0 && trimmedName.length <= WORKSPACE_NAME_MAX_LENGTH && trimmedName !== wsName && !isNameSaving;

  /** 시안에는 저장 버튼이 없어 Enter·포커스 이탈 때 저장한다(닉네임과 같은 방식). */
  async function saveWorkspaceName() {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return;
    if (!trimmedName) {
      setNameSaved(false);
      setNameError(t("workspace.name.required"));
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
      setNameError(getErrorMessage(error, t("workspace.name.saveFailed")));
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
      <SettingsPanelTitle title={t("workspace.title")} description={t("workspace.description")} />

      <div className={styles.section}>
        <SettingsSectionHeader>{t("workspace.name.section")}</SettingsSectionHeader>
        <div className={styles.field}>
          <label htmlFor="workspace-name">{t("workspace.name.label")}</label>
          <small id="workspace-name-hint">{t("workspace.name.hint", { max: WORKSPACE_NAME_MAX_LENGTH })}</small>
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
          {isNameSaving ? <small role="status">{t("common.saving")}</small> : nameSaved && <small role="status">{t("workspace.name.saved")}</small>}
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("workspace.icon.section")}</SettingsSectionHeader>
        <div className={styles["stack-20"]}>
          <WorkspaceIconSettings />
          <div className={styles.row}>
            <div className={styles["row-title"]}>
              <strong>{t("workspace.autoSave.label")}</strong>
              <small>{t("workspace.autoSave.description")}</small>
            </div>
            <Switch checked={preferences.autoSave} label={t("workspace.autoSave.label")}
              onClick={() => updatePreferences((current) => ({ ...current, autoSave: !current.autoSave }))} />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("workspace.model.section")}</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{t("workspace.model.label")}</strong>
            <small>{t("workspace.model.description")}</small>
            {hasExcludedModels && <small>{t("workspace.model.claudeChatOnly")}</small>}
            {!canUpdateAiModel && <small>{t("workspace.model.ownerOnly")}</small>}
            {isSelectionFallback && <small>{t("workspace.model.fallback")}</small>}
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
        <SettingsSectionHeader>{t("workspace.autoIngest.section")}</SettingsSectionHeader>
        {autoIngestRows.map((row) => (
          <div key={row.field} className={styles.row}>
            <div className={styles["row-title"]}>
              <strong>{t(`workspace.autoIngest.rows.${row.key}.label`)}</strong>
              <small>
                {t(`workspace.autoIngest.rows.${row.key}.description`)} {t("workspace.autoIngest.costNote")}
              </small>
              {!isOwner && <small>{t("common.ownerOnlySetting")}</small>}
              {autoIngestError?.field === row.field && <small className={styles["row-error"]} role="alert">{autoIngestError.message}</small>}
            </div>
            <Switch
              checked={row.checked}
              label={t(`workspace.autoIngest.rows.${row.key}.label`)}
              // 저장 중에 disabled로 바꾸면 스위치의 포커스가 body로 빠진다. 중복 요청은 toggleAutoIngest의 savingAutoIngestField 검사가 막는다.
              disabled={!isOwner || !workspace}
              onClick={() => void toggleAutoIngest(row.field, !row.checked)}
            />
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("workspace.describeFigures.section")}</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{t("workspace.describeFigures.label")}</strong>
            <small>{t("workspace.describeFigures.description")}</small>
            {!isOwner && <small>{t("common.ownerOnlySetting")}</small>}
            {describeFiguresError && <small className={styles["row-error"]} role="alert">{describeFiguresError}</small>}
          </div>
          <Switch
            checked={describePdfFigures}
            label={t("workspace.describeFigures.label")}
            disabled={!isOwner || !workspace}
            onClick={() => void toggleDescribePdfFigures()}
          />
        </div>
      </div>
    </div>
  );
}

/** 문구는 settings 메시지 workspace.autoIngest.rows.<key>에 있다. */
type AutoIngestSettingRow = { field: AutoIngestSettingField; key: "markdown" | "pdfOnConvert" | "legacyPdf"; checked: boolean };

/** 자동 편입 스위치 목록. 새 서버(auto_ingest_markdown_on_upload가 있음)는 Markdown·PDF를 따로, 구 서버는 하나만 둔다. */
function autoIngestSettingRows(workspace: WorkspaceResponse | null): AutoIngestSettingRow[] {
  if (typeof workspace?.auto_ingest_markdown_on_upload === "boolean") {
    return [
      { field: "auto_ingest_markdown_on_upload", key: "markdown", checked: workspace.auto_ingest_markdown_on_upload },
      {
        field: "auto_ingest_pdf_on_convert",
        key: "pdfOnConvert",
        checked: (workspace.auto_ingest_pdf_on_convert ?? workspace.auto_ingest_on_upload) === true
      }
    ];
  }
  return [{ field: "auto_ingest_on_upload", key: "legacyPdf", checked: workspace?.auto_ingest_on_upload === true }];
}
