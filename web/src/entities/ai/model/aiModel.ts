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

// 채팅 모델 메뉴의 provider 행 이름 (Figma 1691:16178). 하위 메뉴 머리글은 getProviderLabel을 쓴다.
const PROVIDER_MENU_LABELS: Record<string, string> = {
  openai: "Chat GPT"
};

/** 채팅 모델 메뉴의 provider 행 이름. 따로 정한 이름이 없으면 getProviderLabel과 같다. */
export function getProviderMenuLabel(provider: string): string {
  return PROVIDER_MENU_LABELS[provider] ?? getProviderLabel(provider);
}

type AiModelGroup = { provider: string; models: AiModel[] };

/** 카탈로그를 provider별로 묶는다. provider와 모델 순서는 카탈로그(백엔드) 순서를 그대로 따른다. */
export function groupAiModelsByProvider(models: AiModel[]): AiModelGroup[] {
  const groups = new Map<string, AiModel[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return Array.from(groups, ([provider, items]) => ({ provider, models: items }));
}

// 워크스페이스 공용 모델(ingest_lint)에는 Claude를 쓸 수 없다. 백엔드가 claude 저장을 400으로 거절한다.
const WORKSPACE_EXCLUDED_PROVIDERS = new Set(["claude"]);

/** 저장값을 쓸 수 없을 때 백엔드가 대신 쓰는 워크스페이스 기본 모델. */
export const WORKSPACE_DEFAULT_MODEL: AiModelSelection = { provider: "gemini", model: "gemini-3.5-flash-lite" };

/** 워크스페이스 모델 설정에서 고를 수 있는 모델만 남긴다(Claude 제외). */
export function filterWorkspaceAiModels(catalog: AiModel[]): AiModel[] {
  return catalog.filter((item) => !WORKSPACE_EXCLUDED_PROVIDERS.has(item.provider));
}

/** 카탈로그에 워크스페이스 설정에서 뺀 provider(Claude) 모델이 있는지 확인한다. */
export function hasWorkspaceExcludedModels(catalog: AiModel[]): boolean {
  return catalog.some((item) => WORKSPACE_EXCLUDED_PROVIDERS.has(item.provider));
}

/**
 * 워크스페이스 설정 화면에 보여 줄 실제 적용 모델을 정한다.
 * 저장값이 Claude이거나 카탈로그에서 빠졌으면 백엔드와 같은 기본 모델로 대체해 보여 준다.
 * 카탈로그를 아직 받지 못했으면 Claude가 아닌 저장값은 그대로 둔다.
 */
export function resolveWorkspaceModelSelection(
  workspaceModels: AiModel[],
  saved: AiModelSelection | null
): { selection: AiModelSelection | null; isFallback: boolean } {
  if (!saved) return { selection: null, isFallback: false };
  const isExcluded = WORKSPACE_EXCLUDED_PROVIDERS.has(saved.provider);
  const isAvailable = workspaceModels.length === 0 || workspaceModels.some((item) => isSameSelection(item, saved));
  if (!isExcluded && isAvailable) return { selection: saved, isFallback: false };
  return { selection: WORKSPACE_DEFAULT_MODEL, isFallback: true };
}
