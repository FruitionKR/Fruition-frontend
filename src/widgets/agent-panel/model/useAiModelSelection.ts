import { useEffect, useState } from "react";
import type { AiModelCatalogStatus } from "@/features/agent-chat/ui/AgentComposer";
import { fetchAiModels, resolveInitialModel, type AiModel } from "@/entities/ai";
import { useUserPreferences } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/errors";

/** 채팅에 쓸 AI 모델 카탈로그·선택과 웹 검색 설정. 선택은 사용자 설정에 저장한다. */
export function useAiModelSelection() {
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<AiModel | null>(null);
  const [aiModelCatalogStatus, setAiModelCatalogStatus] = useState<AiModelCatalogStatus>("loading");
  const [aiModelsErrorMessage, setAiModelsErrorMessage] = useState<string | null>(null);
  const { preferences, preferencesReady, updatePreferences } = useUserPreferences();
  const allowWebSearch = preferences.webSearch;

  // 선택 가능한 모델은 백엔드 카탈로그가 정한다. 프론트에 목록을 고정하지 않는다.
  useEffect(() => {
    fetchAiModels()
      .then((models) => {
        setAiModels(models);
        if (models.length === 0) {
          setAiModelCatalogStatus("empty");
          setAiModelsErrorMessage("사용 가능한 AI 모델이 없습니다.");
          return;
        }
        setAiModelCatalogStatus("ready");
      })
      .catch((error: unknown) => {
        setAiModelCatalogStatus("error");
        setAiModelsErrorMessage(getErrorMessage(error, "AI 모델 목록을 불러오지 못했습니다."));
      });
  }, []);
  // 카탈로그와 저장된 설정이 모두 준비된 뒤 초기 선택을 확정한다.
  useEffect(() => {
    if (!preferencesReady || aiModels.length === 0 || selectedModel) return;
    setSelectedModel(resolveInitialModel(aiModels, preferences.aiModel));
  }, [aiModels, preferences.aiModel, preferencesReady, selectedModel]);

  function handleWebSearchChange(enabled: boolean) {
    updatePreferences((current) => ({ ...current, webSearch: enabled }));
  }

  function handleModelChange(model: AiModel) {
    setSelectedModel(model);
    updatePreferences((current) => ({
      ...current,
      aiModel: { provider: model.provider, model: model.model }
    }));
  }

  return {
    aiModels,
    selectedModel,
    aiModelCatalogStatus,
    aiModelsErrorMessage,
    allowWebSearch,
    handleWebSearchChange,
    handleModelChange
  };
}
