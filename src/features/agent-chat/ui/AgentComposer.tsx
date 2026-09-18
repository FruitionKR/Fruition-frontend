import { ArrowUp, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AiModel } from "@/entities/ai";
import { cx } from "@/shared/lib/classNames";
import { useDismissOnOutside } from "@/shared/lib/useDismissOnOutside";
import styles from "./AgentChat.module.css";

export type AiModelCatalogStatus = "loading" | "ready" | "empty" | "error";

/** provider/model 쌍을 목록 key와 선택 비교에 쓰는 문자열로 만든다. */
function modelKey(model: AiModel) {
  return `${model.provider}/${model.model}`;
}

export function AgentComposer({
  value = "",
  isLoading,
  placeholder = "AI 에이전트에게 무엇이든 물어보세요.",
  models,
  selectedModel,
  modelCatalogStatus,
  canSubmit,
  onModelChange,
  allowWebSearch = false,
  onWebSearchChange,
  onChange,
  onSubmit,
  onCancel,
  isCancelling = false,
  statusMessage
}: {
  value: string;
  isLoading: boolean;
  placeholder?: string;
  models: AiModel[];
  selectedModel: AiModel | null;
  modelCatalogStatus: AiModelCatalogStatus;
  canSubmit: boolean;
  onModelChange: (model: AiModel) => void;
  allowWebSearch?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;
  statusMessage?: string | null;
}) {
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const modelListRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = selectedModel ? modelKey(selectedModel) : null;

  useDismissOnOutside(modelListRef, isModelListOpen, () => setIsModelListOpen(false));

  useEffect(() => {
    if (isLoading) setIsModelListOpen(false);
  }, [isLoading]);

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && onCancel && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !isCancelling) onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (isLoading || !canSubmit) return;
      onSubmit();
    }
  }

  const emptyModelLabel = modelCatalogStatus === "empty"
    ? "사용 가능한 모델 없음"
    : modelCatalogStatus === "error"
      ? "모델 불러오기 실패"
      : "모델 불러오는 중";

  return (
    <form className={styles.composer} onSubmit={submitComposer}>
      <textarea
        value={value}
        placeholder={placeholder}
        disabled={isLoading && !onCancel}
        readOnly={isLoading}
        aria-label="Query 질문 입력"
        aria-keyshortcuts={onCancel ? "Escape" : undefined}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {(statusMessage || onCancel) && (
        <p className={cx(styles["composer-status"], !isLoading && statusMessage && styles["composer-cancelled"])} role="status">
          {statusMessage ?? "입력창에서 Esc를 누르면 질문을 취소합니다."}
        </p>
      )}
      <div className={styles["composer-actions"]}>
        <div className={styles["composer-model"]} ref={modelListRef}>
          <button
            type="button"
            className={styles["composer-model-trigger"]}
            aria-label="모델 선택"
            aria-expanded={isModelListOpen}
            disabled={isLoading || !selectedModel}
            onClick={() => setIsModelListOpen((open) => !open)}
          >
            <span>{selectedModel?.display_name ?? emptyModelLabel}</span>
            {selectedModel && allowWebSearch && (
              <span className={styles["composer-model-extra"]}>
                <span aria-hidden>·</span>
                <span>웹 서칭</span>
              </span>
            )}
            <ChevronDown size={8} className={cx(isModelListOpen && styles["is-open"])} />
          </button>
          {isModelListOpen && (
            <div className={styles["composer-model-list"]}>
              <div role="listbox" aria-label="모델 목록">
                {models.map((model) => {
                  const isSelected = modelKey(model) === selectedKey;
                  return (
                    <button
                      key={modelKey(model)}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={cx(styles["composer-model-option"], isSelected && styles["is-selected"])}
                      onClick={() => {
                        onModelChange(model);
                        setIsModelListOpen(false);
                      }}
                    >
                      <span>{model.display_name}</span>
                      {isSelected && <Check size={12} aria-hidden />}
                    </button>
                  );
                })}
              </div>
              {onWebSearchChange && (
                <div className={styles["composer-web-search"]}>
                  <div className={styles["composer-web-search-label"]}>
                    <span>웹 서칭</span>
                    <span>필요시, 웹에서 정보를 추가 검색합니다.</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowWebSearch}
                    aria-label="웹 서칭"
                    className={cx(styles["composer-switch"], allowWebSearch && styles["is-on"])}
                    onClick={() => onWebSearchChange(!allowWebSearch)}
                  >
                    <span />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="submit"
          className={styles["composer-send"]}
          aria-label="전송"
          disabled={isLoading || !canSubmit || value.trim().length === 0}
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </form>
  );
}
