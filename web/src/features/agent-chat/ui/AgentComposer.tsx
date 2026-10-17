import Image from "next/image";
import { Square } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getProviderLabel, getProviderMenuLabel, groupAiModelsByProvider, type AiModel } from "@/entities/ai";
import modelMenuArrowIcon from "@/shared/assets/svg/agent/model-menu-arrow.svg";
import modelMenuCheckIcon from "@/shared/assets/svg/agent/model-menu-check.svg";
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
 * onPickRecording이 있으면 메뉴에 "녹음 파일로 전사"를 두고, 누르면 녹음 파일 선택 창을 연다(같은 클릭 안에서 불러야 열린다).
 */
export type ComposerMeetingControl = {
  state: "idle" | "capturing" | "busy";
  onStart: () => void;
  onStop: () => void;
  onPickRecording?: () => void;
};

/** provider/model 쌍을 목록 key와 선택 비교에 쓰는 문자열로 만든다. */
function modelKey(model: AiModel) {
  return `${model.provider}/${model.model}`;
}

/** 모델 메뉴와 트리거 사이 간격(Figma 1691:16168). 메뉴 오른쪽 끝은 입력 박스 오른쪽 끝에 맞춘다. */
const MODEL_MENU_GAP = 8;

/** container 안 버튼 중 지금 포커스에서 step만큼 옮긴 버튼에 포커스를 준다(양끝은 이어진다). */
function moveFocus(container: HTMLElement | null, step: number) {
  const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  if (buttons.length === 0) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(index + step + buttons.length) % buttons.length]?.focus();
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
  // 오른쪽 하위 메뉴에 모델을 보여 주는 provider. 메뉴를 열 때 선택된 모델의 provider로 맞춘다.
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  // 메뉴가 채팅 패널(overflow: hidden) 왼쪽 밖으로 펼쳐지므로 화면 기준(fixed) 좌표로 띄운다.
  const [modelMenuPosition, setModelMenuPosition] = useState<{ right: number; bottom: number } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const modelListRef = useRef<HTMLDivElement | null>(null);
  const providerListRef = useRef<HTMLDivElement | null>(null);
  const modelSubmenuRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelSubmenuId = useId();
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const waveButtonRef = useRef<HTMLButtonElement | null>(null);
  // 받아쓴 텍스트는 입력창에 채우기만 한다. 전송은 사용자가 확인한 뒤 직접 한다.
  const dictation = useDictation((text) => onChange(appendDictation(value, text)));
  const isRecording = dictation.status === "recording";
  const isTranscribing = dictation.status === "transcribing";
  const selectedKey = selectedModel ? modelKey(selectedModel) : null;
  const modelGroups = groupAiModelsByProvider(models);
  const activeGroup = modelGroups.find((group) => group.provider === activeProvider) ?? null;

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

  // 메뉴를 열면 선택된 모델의 provider 행에 포커스를 준다.
  useEffect(() => {
    if (!isModelListOpen) return;
    providerListRef.current?.querySelector<HTMLButtonElement>("[aria-expanded='true']")?.focus();
  }, [isModelListOpen]);

  // fixed 좌표는 열 때 한 번 잡으므로 창 크기가 바뀌면 메뉴를 닫는다.
  useEffect(() => {
    if (!isModelListOpen) return;
    const close = () => setIsModelListOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [isModelListOpen]);

  function openModelList() {
    const formRect = formRef.current?.getBoundingClientRect();
    const triggerRect = modelTriggerRef.current?.getBoundingClientRect();
    if (!formRect || !triggerRect) return;
    setModelMenuPosition({
      right: document.documentElement.clientWidth - formRect.right,
      bottom: window.innerHeight - triggerRect.top + MODEL_MENU_GAP
    });
    setActiveProvider(selectedModel?.provider ?? modelGroups[0]?.provider ?? null);
    setIsModelListOpen(true);
  }

  /** provider 행에서 오른쪽 하위 메뉴로 들어간다. 선택된 모델이 있으면 그 모델에, 없으면 첫 모델에 포커스를 준다. */
  function enterModelSubmenu(provider: string) {
    setActiveProvider(provider);
    // 하위 메뉴가 바뀐 provider로 다시 그려진 뒤에 포커스를 옮긴다.
    requestAnimationFrame(() => {
      const submenu = modelSubmenuRef.current;
      (submenu?.querySelector<HTMLButtonElement>("[aria-selected='true']") ?? submenu?.querySelector<HTMLButtonElement>("button"))?.focus();
    });
  }

  function handleProviderKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, provider: string) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(providerListRef.current, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      enterModelSubmenu(provider);
    }
  }

  function handleModelKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(modelSubmenuRef.current, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      providerListRef.current?.querySelector<HTMLButtonElement>("[aria-expanded='true']")?.focus();
    }
  }

  function chooseModel(model: AiModel) {
    onModelChange(model);
    setIsModelListOpen(false);
    // Safari는 클릭한 버튼에 포커스를 주지 않으므로 목록 안 포커스 여부와 관계없이 트리거로 돌려준다.
    const trigger = modelTriggerRef.current;
    if (trigger && !trigger.disabled) trigger.focus();
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
    <form className={styles.composer} ref={formRef} onSubmit={submitComposer}>
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
          {/* Figma 1691:16177: 왼쪽 provider 메뉴(1691:16178, 아래 웹 서칭) + 오른쪽 하위 메뉴(1691:16196, provider의 모델) */}
          {isModelListOpen && modelMenuPosition && (
            <div className={styles["composer-model-menu"]} style={modelMenuPosition}>
              <div className={styles["composer-model-list"]}>
                <div ref={providerListRef} className={styles["composer-model-providers"]} role="group" aria-label="모델 제공사">
                  {modelGroups.map((group) => {
                    const isActive = group.provider === activeProvider;
                    return (
                      <button
                        key={group.provider}
                        type="button"
                        className={cx(styles["composer-model-provider"], isActive && styles["is-active"])}
                        aria-haspopup="listbox"
                        aria-expanded={isActive}
                        aria-controls={isActive ? modelSubmenuId : undefined}
                        onMouseEnter={() => setActiveProvider(group.provider)}
                        onFocus={() => setActiveProvider(group.provider)}
                        onClick={() => enterModelSubmenu(group.provider)}
                        onKeyDown={(event) => handleProviderKeyDown(event, group.provider)}
                      >
                        <span>{getProviderMenuLabel(group.provider)}</span>
                        {isActive && <Image src={modelMenuArrowIcon} alt="" aria-hidden className={styles["composer-model-arrow"]} />}
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
                    <Switch
                      checked={allowWebSearch}
                      label="웹 서칭"
                      classNames={{ root: styles["composer-switch"], on: styles["is-on"] }}
                      onClick={() => onWebSearchChange(!allowWebSearch)}
                    />
                  </div>
                )}
              </div>
              {activeGroup && (
                // 하위 메뉴는 높이 0 칸 안에서 아래로 넘쳐 그린다. 메뉴 높이는 왼쪽 메뉴로만 정해져 트리거 바로 위에 붙는다.
                <div className={styles["composer-model-submenu-slot"]}>
                  <div className={styles["composer-model-submenu"]}>
                    <p className={styles["composer-model-group-label"]} aria-hidden>
                      {getProviderLabel(activeGroup.provider)}
                    </p>
                    <div
                      id={modelSubmenuId}
                      ref={modelSubmenuRef}
                      role="listbox"
                      aria-label={`${getProviderLabel(activeGroup.provider)} 모델`}
                      className={styles["composer-model-options"]}
                    >
                      {activeGroup.models.map((model) => {
                        const isSelected = modelKey(model) === selectedKey;
                        return (
                          <button
                            key={modelKey(model)}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={styles["composer-model-option"]}
                            onClick={() => chooseModel(model)}
                            onKeyDown={handleModelKeyDown}
                          >
                            <span>{model.display_name}</span>
                            {isSelected && <Image src={modelMenuCheckIcon} alt="" aria-hidden />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                {meetingControl.onPickRecording && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={meetingControl.state !== "idle"}
                    onClick={() => {
                      closeVoiceMenu();
                      meetingControl.onPickRecording?.();
                    }}
                  >
                    <span>녹음 파일로 전사</span>
                    <span>{meetingControl.state === "idle" ? "WAV·MP3·M4A·WebM(500MB 이하)을 받아써요" : "열린 회의 화면을 닫은 뒤 시작할 수 있어요"}</span>
                  </button>
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
            <AgentSendIcon />
          </button>
        </div>
      </div>
    </form>
  );
}
