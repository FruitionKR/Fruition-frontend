"use client";

import { useState } from "react";
import Image from "next/image";
import { Lock } from "lucide-react";
import {
  getAiModelLockMessage,
  getProviderLabel,
  isProviderLocked,
  isSameSelection,
  type AiModel,
  type AiModelOption,
  type AiModelSelection
} from "@/entities/ai";
import modelMenuArrowIcon from "@/shared/assets/svg/agent/model-menu-arrow.svg";
import modelMenuCheckIcon from "@/shared/assets/svg/agent/model-menu-check.svg";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { cx } from "@/shared/lib/classNames";
import { claudeIcon, geminiIcon, gptIcon, SvgIcon, type SvgAsset } from "@/shared/ui/SvgIcon";
import styles from "../SettingsModal.module.css";
import panelStyles from "./WorkspacePanel.module.css";

// provider id → 아이콘
const providerIcons: Record<string, SvgAsset> = {
  openai: gptIcon,
  gemini: geminiIcon,
  claude: claudeIcon
};

/**
 * LLM Provider 선택 (Figma 1691:17216 기본 / 1691:17420 펼침).
 * 현재 모델 칩 — 짧은 선 — "모델 변경" 버튼. 버튼을 누르면 칩 아래에 provider 메뉴와 그 provider의 모델 메뉴를 나란히 연다.
 * 저가 모델 정책(#184·#185)으로 잠긴 provider·모델도 자물쇠와 사유를 붙여 보여 주고 고를 수 없게 한다.
 */
export function WorkspaceModelMenu({
  modelOptions,
  selection,
  canUpdate,
  isSaving,
  onSelect
}: {
  /** 잠긴 모델까지 포함한 화면용 목록 */
  modelOptions: AiModelOption[];
  /** 화면에 보여 줄(대체 적용된) 현재 선택 */
  selection: AiModelSelection | null;
  canUpdate: boolean;
  isSaving: boolean;
  onSelect: (model: AiModel) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // provider를 고르면 오른쪽 모델 메뉴만 바뀐다. 저장은 모델을 고를 때 한다.
  const [viewingProvider, setViewingProvider] = useState<string | null>(null);
  const menuRef = useDismissableMenu(isOpen, () => setIsOpen(false));

  const providers = Array.from(new Set(modelOptions.map((model) => model.provider)));
  const savedProvider = selection && providers.includes(selection.provider) ? selection.provider : null;
  const activeProvider = viewingProvider ?? savedProvider ?? providers[0] ?? null;
  const providerModels = modelOptions.filter((model) => model.provider === activeProvider);
  const selectedIcon = selection ? providerIcons[selection.provider] : undefined;

  function toggle() {
    setViewingProvider(null);
    setIsOpen((open) => !open);
  }

  return (
    <div className={panelStyles["model-select"]} ref={menuRef}>
      {selection && (
        <span className={panelStyles.pill}>
          {selectedIcon && <SvgIcon src={selectedIcon} className={panelStyles["pill-icon"]} />}
          {getProviderLabel(selection.provider)} • {selection.model}
        </span>
      )}
      <span className={panelStyles["model-divider"]} aria-hidden />
      <button
        type="button"
        className={styles.btn}
        disabled={!canUpdate}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        모델 변경
      </button>

      {isOpen && canUpdate && (
        <div className={panelStyles["model-menu"]}>
          <div className={panelStyles["model-menu-card"]} role="group" aria-label="모델 제공사">
            {providers.length === 0 && <p className={panelStyles["model-menu-empty"]}>사용할 수 있는 모델이 없습니다.</p>}
            {providers.map((provider) => {
              const isActive = provider === activeProvider;
              // 모델이 모두 잠긴 provider(Claude)도 눌러서 잠긴 모델을 볼 수 있다. 자물쇠로 쓸 수 없음을 알린다.
              const isLocked = isProviderLocked(modelOptions.filter((model) => model.provider === provider));
              return (
                <button
                  key={provider}
                  type="button"
                  className={cx(panelStyles["provider-option"], isActive && panelStyles["is-active"], isLocked && panelStyles["is-locked"])}
                  aria-pressed={isActive}
                  disabled={isSaving}
                  onMouseEnter={() => setViewingProvider(provider)}
                  onClick={() => setViewingProvider(provider)}
                >
                  <span className={panelStyles["provider-name"]}>
                    {getProviderLabel(provider)}
                    {isLocked && <Lock size={12} aria-label="사용 불가" role="img" />}
                  </span>
                  {isActive && <Image src={modelMenuArrowIcon} alt="" aria-hidden className={panelStyles["provider-arrow"]} />}
                </button>
              );
            })}
          </div>
          {activeProvider && providerModels.length > 0 && (
            <div className={cx(panelStyles["model-menu-card"], panelStyles["is-models"])}>
              <p className={panelStyles["model-group-label"]} aria-hidden>{getProviderLabel(activeProvider)}</p>
              <div role="group" aria-label={`${getProviderLabel(activeProvider)} 모델`} className={panelStyles["model-options"]}>
                {providerModels.map((model) => {
                  const isSelected = isSameSelection(model, selection);
                  const lockMessage = model.lockReason ? getAiModelLockMessage(model.lockReason) : null;
                  return (
                    <button
                      key={model.model}
                      type="button"
                      className={cx(panelStyles["model-option"], lockMessage && panelStyles["is-locked"])}
                      aria-pressed={isSelected}
                      aria-disabled={lockMessage ? true : undefined}
                      aria-label={lockMessage ? `${model.display_name}, ${lockMessage}` : undefined}
                      title={lockMessage ?? model.model}
                      disabled={isSaving}
                      // 잠긴 모델은 포커스는 받지만 고를 수 없다.
                      onClick={() => {
                        if (lockMessage) return;
                        onSelect(model);
                        setIsOpen(false);
                      }}
                    >
                      <span className={panelStyles["model-option-text"]}>{model.display_name}</span>
                      {isSelected && <Image src={modelMenuCheckIcon} alt="" aria-hidden />}
                      {lockMessage && <Lock size={14} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
