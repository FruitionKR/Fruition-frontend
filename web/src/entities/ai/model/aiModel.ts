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

type AiModelGroup<T extends AiModel> = { provider: string; models: T[] };

/** 카탈로그를 provider별로 묶는다. provider와 모델 순서는 카탈로그(백엔드) 순서를 그대로 따른다. */
export function groupAiModelsByProvider<T extends AiModel>(models: T[]): AiModelGroup<T>[] {
  const groups = new Map<string, T[]>();
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

/** 잠긴 모델을 고를 수 없는 이유. cost_policy: 저가 모델 정책으로 카탈로그에서 빠짐, workspace_claude: 워크스페이스 공용 설정에 Claude 불가. */
export type AiModelLockReason = "cost_policy" | "workspace_claude";

/** 모델 선택 화면에 보여 줄 모델. lockReason이 있으면 잠금으로 보여 주고 고를 수 없다. */
export type AiModelOption = AiModel & { lockReason: AiModelLockReason | null };

const LOCK_REASON_MESSAGES: Record<AiModelLockReason, string> = {
  cost_policy: "비용 정책으로 사용할 수 없는 모델",
  workspace_claude: "Claude 모델은 채팅에서 직접 선택할 때만 사용할 수 있습니다."
};

/** 잠금 이유를 화면 문구로 바꾼다. */
export function getAiModelLockMessage(reason: AiModelLockReason): string {
  return LOCK_REASON_MESSAGES[reason];
}

/**
 * 채팅 모델 메뉴에 보여 줄 목록: 카탈로그 모델은 선택 가능, 잠금 목록 중 카탈로그에 없는 모델은 잠금.
 * 같은 provider 안에서는 선택 가능한 모델을 먼저 둔다. 카탈로그를 아직 받지 못했으면(빈 목록) 잠금 모델도 보여 주지 않는다.
 */
export function buildChatModelOptions(catalog: AiModel[], locked: readonly AiModel[]): AiModelOption[] {
  if (catalog.length === 0) return [];
  const available: AiModelOption[] = catalog.map((item) => ({ ...item, lockReason: null }));
  const lockedOnly: AiModelOption[] = locked
    .filter((item) => !catalog.some((model) => isSameSelection(model, item)))
    .map((item) => ({ ...item, lockReason: "cost_policy" }));
  const providers = Array.from(new Set([...available, ...lockedOnly].map((item) => item.provider)));
  return providers.flatMap((provider) => [
    ...available.filter((item) => item.provider === provider),
    ...lockedOnly.filter((item) => item.provider === provider)
  ]);
}

/** 워크스페이스 모델 설정에 보여 줄 목록: 채팅 목록에서 Claude provider 모델을 모두 워크스페이스 잠금으로 바꾼다. */
export function buildWorkspaceModelOptions(catalog: AiModel[], locked: readonly AiModel[]): AiModelOption[] {
  return buildChatModelOptions(catalog, locked).map((item) =>
    WORKSPACE_EXCLUDED_PROVIDERS.has(item.provider) ? { ...item, lockReason: "workspace_claude" } : item
  );
}

/** provider의 모델이 모두 잠겼는지 확인한다. 이런 provider는 provider 행도 잠금으로 보여 준다. */
export function isProviderLocked(models: AiModelOption[]): boolean {
  return models.length > 0 && models.every((item) => item.lockReason !== null);
}
