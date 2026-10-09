// 백엔드 GET /api/ai-models 응답의 모델 한 개.
export type AiModel = {
  provider: string;
  model: string;
  display_name: string;
};

export type AiModelsResponse = { models: AiModel[] };

/** 질의 요청에 실을 provider/model 쌍. 반드시 함께 전달해야 한다. */
export type AiModelSelection = { provider: string; model: string };

export type WorkspaceAiModelSettings = {
  ingest_lint: AiModelSelection;
  /** 호출자가 이 설정을 변경할 수 있는지(워크스페이스 OWNER 여부). */
  can_update: boolean;
};

/**
 * 저장된 마지막 선택을 카탈로그와 대조해 초기 선택을 정한다.
 * 저장값이 카탈로그에 없으면(모델 교체·provider 비활성화·localStorage 조작) 첫 항목으로 되돌린다.
 */
export function resolveInitialModel(
  catalog: AiModel[],
  stored: AiModelSelection | null
): AiModel | null {
  if (catalog.length === 0) return null;
  const matched = stored
    ? catalog.find((item) => item.provider === stored.provider && item.model === stored.model)
    : undefined;
  return matched ?? catalog[0];
}

/** 저장된 선택과 provider·model이 모두 같은 조합인지 비교한다. */
export function isSameSelection(selected: AiModelSelection, current: AiModelSelection | null): boolean {
  return selected.provider === current?.provider && selected.model === current?.model;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  claude: "Claude"
};

/** provider id를 화면 표시 라벨로 바꾼다. 모르는 provider는 id를 그대로 보여 준다. */
export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export type AiModelGroup = { provider: string; models: AiModel[] };

/** 카탈로그를 provider별로 묶는다. provider와 모델 순서는 카탈로그(백엔드) 순서를 그대로 따른다. */
export function groupAiModelsByProvider(models: AiModel[]): AiModelGroup[] {
  const groups = new Map<string, AiModel[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return Array.from(groups, ([provider, items]) => ({ provider, models: items }));
}

/** 모델 표시 이름 또는 model id에 검색어가 들어간 항목만 남긴다(대소문자·앞뒤 공백 무시). */
export function filterAiModels(models: AiModel[], query: string): AiModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return models;
  return models.filter(
    (item) =>
      item.display_name.toLowerCase().includes(normalized) || item.model.toLowerCase().includes(normalized)
  );
}
