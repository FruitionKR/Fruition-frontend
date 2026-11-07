import { apiFetch, parseJsonOrThrow, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import type { AiModel, AiModelCatalog, AiModelsResponse, AiModelSelection, WorkspaceAiModelSettings } from "../model/aiModel";
import { sharedText } from "@/shared/i18n/sharedTranslate";

/**
 * 선택 가능한 provider/model 조합과 답변 듣기 사용 가능 여부를 백엔드 카탈로그에서 가져온다.
 * 답변 듣기는 서버가 true라고 알릴 때만 켠다(필드가 없는 이전 서버는 꺼진 것으로 본다).
 */
export async function fetchAiModelCatalog(): Promise<AiModelCatalog> {
  const response = await apiFetch("/api/ai-models", { cache: "no-store" });
  const body = await parseJsonOrThrow<AiModelsResponse>(response, ERROR_MESSAGES.aiModelsLoadFailed);
  return { models: body.models ?? [], isSpeechSynthesisEnabled: body.speech_synthesis_enabled === true };
}

/** 선택 가능한 provider/model 조합을 백엔드 카탈로그에서 가져온다. */
export async function fetchAiModels(): Promise<AiModel[]> {
  return (await fetchAiModelCatalog()).models;
}

/** ingest·lint에 사용하는 워크스페이스 모델 설정을 조회한다. */
export async function fetchWorkspaceAiModelSettings(): Promise<WorkspaceAiModelSettings> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "ai-model-settings"),
    { cache: "no-store" }
  );
  return parseJsonOrThrow<WorkspaceAiModelSettings>(response, sharedText("ai.requestFailed.providerLoad", "LLM Provider 설정을 불러오지 못했습니다."));
}

/** OWNER가 고른 ingest·lint provider/model 설정을 저장한다. */
export async function updateWorkspaceAiModelSettings(
  selection: AiModelSelection
): Promise<WorkspaceAiModelSettings> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "ai-model-settings"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingest_lint: selection })
    }
  );
  return parseJsonOrThrow<WorkspaceAiModelSettings>(response, sharedText("ai.requestFailed.providerSave", "LLM Provider 설정을 저장하지 못했습니다."));
}
