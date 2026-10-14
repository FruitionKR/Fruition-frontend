import { Check, Square } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { filterAiModels, getProviderLabel, groupAiModelsByProvider, type AiModel } from "@/entities/ai";
import { cx } from "@/shared/lib/classNames";
import { Switch } from "@/shared/ui/Switch";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import { appendDictation } from "../lib/dictation";
import { useDictation } from "../model/useDictation";
import { AgentChevronIcon, AgentSendIcon, AgentWaveMark } from "./AgentIcons";
import styles from "./AgentChat.module.css";

export type AiModelCatalogStatus = "loading" | "ready" | "empty" | "error";

/**
 * 회의 받아쓰기(#148)와 파형 버튼의 관계. idle: 파형 버튼이 음성 입력·회의 받아쓰기 메뉴를 연다.
 * capturing: 회의를 받아쓰는 중이라 파형 버튼이 회의 받아쓰기를 멈춘다. busy: 회의 화면이 열려 있어 새 회의는 시작할 수 없다.
 */
export type ComposerMeetingControl = {
  state: "idle" | "capturing" | "busy";
  onStart: () => void;
  onStop: () => void;
};

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
  statusMessage,
  meetingControl
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
  meetingControl?: ComposerMeetingControl;
}) {
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [activeModelIndex, setActiveModelIndex] = useState(0);
  const modelListRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelListId = useId();
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const waveButtonRef = useRef<HTMLButtonElement | null>(null);
  // 받아쓴 텍스트는 입력창에 채우기만 한다. 전송은 사용자가 확인한 뒤 직접 한다.
  const dictation = useDictation((text) => onChange(appendDictation(value, text)));
  const isRecording = dictation.status === "recording";
  const isTranscribing = dictation.status === "transcribing";
  const selectedKey = selectedModel ? modelKey(selectedModel) : null;
  const modelGroups = groupAiModelsByProvider(filterAiModels(models, modelQuery));
  // 키보드 이동 순서는 화면에 보이는 묶음 순서와 같아야 한다.
  const visibleModels = modelGroups.flatMap((group) => group.models);
  const activeModel = visibleModels[activeModelIndex] ?? null;
  const activeOptionId = activeModel ? modelOptionId(activeModel) : undefined;

  // ESC는 useDismissOnOutside가 ESC 레이어 스택으로 처리한다. 목록 안에 포커스가 있었으면 트리거로 돌려준다.
  function closeModelList() {
    setIsModelListOpen(false);
    if (modelListRef.current?.contains(document.activeElement)) modelTriggerRef.current?.focus();
  }

  useDismissOnOutside(modelListRef, isModelListOpen, closeModelList);
  /** 메뉴를 닫는다. 메뉴 안에 있던 포커스는 사라지는 대신 파형 버튼으로 돌려준다(Esc·항목 선택). */
  function closeVoiceMenu() {
    const hadFocus = voiceMenuRef.current?.contains(document.activeElement) ?? false;
    setIsVoiceMenuOpen(false);
    if (hadFocus) waveButtonRef.current?.focus();
  }
  useDismissOnOutside(voiceMenuRef, isVoiceMenuOpen, closeVoiceMenu);
  const isMeetingCapturing = meetingControl?.state === "capturing";
  // 파형 버튼이 메뉴를 여는 상태. 이때는 토글(aria-pressed)이 아니라 메뉴 버튼으로 알린다.
  const opensVoiceMenu = Boolean(meetingControl) && !isMeetingCapturing && !isRecording;

  function handleWaveClick() {
    if (isMeetingCapturing) {
      meetingControl?.onStop();
      return;
    }
    if (isRecording) {
      dictation.stop();
      return;
    }
    // 회의 받아쓰기를 쓸 수 없는 곳(meetingControl 없음)에서는 지금처럼 바로 음성 입력을 시작한다.
    if (!meetingControl) {
      void dictation.start();
      return;
    }
    setIsVoiceMenuOpen((open) => !open);
  }

  useEffect(() => {
    if (!isLoading) return;
    setIsModelListOpen(false);
    setIsVoiceMenuOpen(false);
  }, [isLoading]);

  // 활성 항목이 스크롤 밖에 있으면 보이도록 맞춘다.
  useEffect(() => {
    if (!isModelListOpen || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [isModelListOpen, activeOptionId]);

  function modelOptionId(model: AiModel) {
    return `${modelListId}-${modelKey(model)}`;
  }

  function openModelList() {
    setModelQuery("");
    const selectedIndex = groupAiModelsByProvider(models)
      .flatMap((group) => group.models)
      .findIndex((model) => modelKey(model) === selectedKey);
    setActiveModelIndex(Math.max(selectedIndex, 0));
    setIsModelListOpen(true);
  }

  function chooseModel(model: AiModel) {
    onModelChange(model);
    setIsModelListOpen(false);
    // Safari는 클릭한 버튼에 포커스를 주지 않으므로 목록 안 포커스 여부와 관계없이 트리거로 돌려준다.
    const trigger = modelTriggerRef.current;
    if (trigger && !trigger.disabled) trigger.focus();
  }

  function handleModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const count = visibleModels.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveModelIndex((index) => (index + step + count) % count);
      return;
    }
    if (event.key === "Enter") {
      // 폼 안의 input이라 Enter가 질문 전송으로 이어지지 않게 막는다.
      event.preventDefault();
      if (activeModel) chooseModel(activeModel);
    }
  }

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
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {(statusMessage || onCancel) && (
        <p className={cx(styles["composer-status"], !isLoading && statusMessage && styles["composer-cancelled"])} role="status">
          {statusMessage ?? "입력창에서 Esc를 누르면 질문을 취소합니다."}
        </p>
      )}
      {dictation.message && (
        <p
          className={cx(styles["composer-status"], dictation.status === "idle" && styles["composer-cancelled"])}
          role={dictation.status === "idle" ? "alert" : "status"}
        >
          {dictation.message}
        </p>
      )}
      <div className={styles["composer-actions"]}>
        <div className={styles["composer-model"]} ref={modelListRef}>
          <button
            type="button"
            className={styles["composer-model-trigger"]}
            ref={modelTriggerRef}
            aria-label="모델 선택"
            aria-expanded={isModelListOpen}
            disabled={isLoading || !selectedModel}
            onClick={() => (isModelListOpen ? setIsModelListOpen(false) : openModelList())}
          >
            <span>{selectedModel?.display_name ?? emptyModelLabel}</span>
            {selectedModel && allowWebSearch && (
              <span className={styles["composer-model-extra"]}>
                <span aria-hidden>·</span>
                <span>웹 서칭</span>
              </span>
            )}
            <AgentChevronIcon isWide className={cx(isModelListOpen && styles["is-open"])} />
          </button>
          {isModelListOpen && (
            <div className={styles["composer-model-list"]}>
              <input
                type="search"
                className={styles["composer-model-search"]}
                placeholder="모델 검색"
                role="combobox"
                aria-label="모델 검색"
                aria-expanded
                aria-controls={modelListId}
                aria-autocomplete="list"
                aria-activedescendant={activeOptionId}
                autoFocus
                value={modelQuery}
                onChange={(event) => {
                  setModelQuery(event.target.value);
                  setActiveModelIndex(0);
                }}
                onKeyDown={handleModelSearchKeyDown}
              />
              <div id={modelListId} role="listbox" aria-label="모델 목록" className={styles["composer-model-options"]}>
                {modelGroups.length === 0 && <p className={styles["composer-model-empty"]}>검색 결과가 없습니다.</p>}
                {modelGroups.map((group) => (
                  <div key={group.provider} role="group" aria-label={getProviderLabel(group.provider)}>
                    <p className={styles["composer-model-group-label"]} aria-hidden>
                      {getProviderLabel(group.provider)}
                    </p>
                    {group.models.map((model) => {
                      const isSelected = modelKey(model) === selectedKey;
                      const isActive = model === activeModel;
                      return (
                        <button
                          key={modelKey(model)}
                          id={modelOptionId(model)}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-selected={isSelected}
                          className={cx(
                            styles["composer-model-option"],
                            isSelected && styles["is-selected"],
                            isActive && styles["is-active"]
                          )}
                          // 키보드 스크롤로 항목이 정지한 커서 아래로 와도 활성 항목을 빼앗지 않도록 실제 마우스 이동에만 반응한다.
                          onMouseMove={() => {
                            if (!isActive) setActiveModelIndex(visibleModels.indexOf(model));
                          }}
                          onClick={() => chooseModel(model)}
                        >
                          <span>{model.display_name}</span>
                          {isSelected && <Check size={12} aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              {onWebSearchChange && (
                <div className={styles["composer-web-search"]}>
                  <div className={styles["composer-web-search-label"]}>
                    <span>웹 서칭</span>
                    <span>필요시, 웹에서 정보를 추가 검색합니다.</span>
                  </div>
                  <Switch
                    checked={allowWebSearch}
                    label="웹 서칭"
                    classNames={{ root: styles["composer-switch"], on: styles["is-on"] }}
                    onClick={() => onWebSearchChange(!allowWebSearch)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {/* Figma 1436:17328: 파란 파형 마크(#147 음성 받아쓰기 버튼) + 회색 원형 전송 버튼.
            회의록 시안(1540:22903)도 같은 자리에 같은 버튼을 둔다. 파형 버튼이 음성 입력과 회의 받아쓰기를 함께 맡는다(#148). */}
        <div className={styles["composer-buttons"]}>
          <div className={styles["composer-voice"]} ref={voiceMenuRef}>
            <button
              type="button"
              className={cx(
                styles["composer-mic"],
                isRecording && styles["is-recording"],
                isMeetingCapturing && styles["is-meeting-recording"]
              )}
              aria-label={isMeetingCapturing ? "회의 받아쓰기 멈추기" : isRecording ? "녹음 멈추기" : meetingControl ? "음성 입력·회의 받아쓰기" : "음성으로 입력"}
              ref={waveButtonRef}
              aria-pressed={opensVoiceMenu ? undefined : isMeetingCapturing || isRecording}
              aria-haspopup={opensVoiceMenu ? "menu" : undefined}
              aria-expanded={opensVoiceMenu ? isVoiceMenuOpen : undefined}
              disabled={!isMeetingCapturing && (isLoading || isTranscribing)}
              onClick={handleWaveClick}
            >
              {isRecording ? <Square size={12} aria-hidden /> : <AgentWaveMark size="small" />}
            </button>
            {isVoiceMenuOpen && meetingControl && (
              <div className={styles["composer-voice-menu"]} role="menu" aria-label="음성 기능">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeVoiceMenu();
                    void dictation.start();
                  }}
                >
                  <span>음성으로 입력</span>
                  <span>말한 내용을 입력창에 채워요(최대 60초)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={meetingControl.state !== "idle"}
                  onClick={() => {
                    closeVoiceMenu();
                    meetingControl.onStart();
                  }}
                >
                  <span>회의 받아쓰기</span>
                  <span>{meetingControl.state === "idle" ? "회의를 받아쓰고 회의록을 만들어요" : "열린 회의 화면을 닫은 뒤 시작할 수 있어요"}</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="submit"
            className={styles["composer-send"]}
            aria-label="전송"
            disabled={isLoading || !canSubmit || value.trim().length === 0}
          >
            <AgentSendIcon />
          </button>
        </div>
      </div>
    </form>
  );
}
