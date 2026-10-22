import type { ThemePreference } from "@/shared/lib/themePreference";

export type MotionPreference = "system" | "reduced" | "full";
export type DocumentFontPreference = "system-sans" | "readable-sans" | "serif";
export type EditorDefaultMode = "last" | "wysiwyg" | "markdown";
export type EditorMode = Exclude<EditorDefaultMode, "last">;

function notificationSetting(group: string, label: string, titles: readonly string[], defaultValue = true, legacyKey?: string) {
  return { group, label, titles, defaultValue, legacyKey, description: `${label}${label.endsWith("알림") ? "" : " 알림"} 카드를 표시합니다.` };
}

/** 설정 화면·기본값·알림 필터가 함께 사용하는 전체 알림 목록. */
export const NOTIFICATION_SETTINGS = {
  completed: notificationSetting("문서·PDF", "문서 처리 완료", ["문서 처리 완료"]),
  failed: notificationSetting("문서·PDF", "문서 처리 실패", ["문서 처리 실패"]),
  pdfCompleted: notificationSetting("문서·PDF", "PDF 변환 완료", ["PDF 변환 완료"], true, "completed"),
  pdfConvertFailed: notificationSetting("문서·PDF", "PDF 변환 요청 실패", ["Markdown 변환 실패"]),
  trashRestore: notificationSetting("문서·PDF", "휴지통 문서 복구", ["문서 복구 완료"]),
  ingestRequested: notificationSetting("위키", "위키 편입 요청", ["위키 편입 요청"]),
  ingestFailed: notificationSetting("위키", "위키 편입 요청 실패", ["위키 편입 실패", "위키 편입 시작 실패"]),
  pdfIngestRequested: notificationSetting("위키", "PDF 변환 후 위키 편입 요청", ["PDF 위키 편입 요청"]),
  pdfIngestFailed: notificationSetting("위키", "PDF 변환 후 위키 편입 실패", ["PDF 위키 편입 실패"]),
  lint: notificationSetting("위키", "위키 최신화 완료", ["위키 최신화 완료"]),
  lintFailed: notificationSetting("위키", "위키 최신화 작업 실패", [], true, "lint"),
  lintRequestFailed: notificationSetting("위키", "위키 최신화 요청 실패", ["위키 최신화 실패"]),
  lintUpToDate: notificationSetting("위키", "위키 최신 상태 안내", ["Wiki 최신 상태"]),
  restore: notificationSetting("위키", "AI 작업 롤백 완료·요청", ["롤백 요청 완료"]),
  restoreFailed: notificationSetting("위키", "AI 롤백 작업 실패", [], true, "restore"),
  restoreRequestFailed: notificationSetting("위키", "AI 롤백 요청 실패", ["롤백 실패"]),
  suggest: notificationSetting("작업 제안", "미편입 문서 안내", ["위키 편입 대기 중인 문서가 있습니다"]),
  newDocument: notificationSetting("작업 제안", "새 문서 편입 제안", ["새 문서가 추가되었습니다"], true, "suggest"),
  ingestStalled: notificationSetting("작업 제안", "편입 대기 리마인드", ["위키 편입이 아직 시작되지 않았습니다"], true, "suggest"),
  ingestChanged: notificationSetting("작업 제안", "수정된 문서 재편입 제안", ["마지막 위키 편입 이후 수정된 문서가 있습니다"], true, "suggest"),
  lintSuggest: notificationSetting("작업 제안", "위키 최신화 제안", ["위키 최신화 제안"], true, "suggest"),
  query: notificationSetting("채팅·AI", "질의 완료", ["질의 완료"], false),
  queryFailed: notificationSetting("채팅·AI", "질의 실패", ["질의 실패"], false, "query"),
  conversationFailed: notificationSetting("채팅·AI", "대화 준비 실패", ["대화 준비 실패"]),
  chatExported: notificationSetting("채팅·AI", "채팅 문서 저장 완료", ["채팅 편입 완료"]),
  chatExportFailed: notificationSetting("채팅·AI", "채팅 문서 저장 실패", ["채팅 편입 실패"]),
  questionCancelFailed: notificationSetting("채팅·AI", "질문 취소 확인 실패", ["질문 취소 확인 실패"]),
  taskCancelFailed: notificationSetting("채팅·AI", "AI 작업 취소 확인 실패", ["작업 취소 확인 실패"]),
  taskStopFailed: notificationSetting("채팅·AI", "AI 작업 중지 실패", ["작업 중지 실패"]),
  taskAlreadyFinished: notificationSetting("채팅·AI", "이미 끝난 AI 작업 안내", ["이미 끝난 작업"]),
  meetingDeleted: notificationSetting("채팅·AI", "회의 삭제 완료", ["회의 삭제"]),
  noteSaveFailed: notificationSetting("편집기", "노트 저장 실패", ["노트 저장 실패"]),
  saveMerged: notificationSetting("편집기", "동시 편집 저장 안내", ["지금 내용으로 저장했어요"]),
  editPermissionLost: notificationSetting("편집기", "편집 권한 상실", ["편집 권한 상실"]),
  externalImageBlocked: notificationSetting("편집기", "외부 이미지 차단", ["외부 이미지 차단"]),
  imageUploadFailed: notificationSetting("편집기", "이미지 첨부 실패", ["이미지 첨부 실패"]),
  permissionChanged: notificationSetting("파일·폴더", "권한 변경 완료", ["권한 변경"]),
  moveCompleted: notificationSetting("파일·폴더", "항목 이동 완료", ["이동 완료"]),
  moveFailed: notificationSetting("파일·폴더", "항목 이동 실패", ["이동 실패", "항목 이동 실패", "일부 이동 실패"]),
  deleteCompleted: notificationSetting("파일·폴더", "항목 삭제 완료", ["삭제 완료"]),
  deleteFailed: notificationSetting("파일·폴더", "항목 삭제 실패", ["삭제 실패", "일부 삭제 실패"]),
  folderCreateFailed: notificationSetting("파일·폴더", "폴더 생성 실패", ["폴더 생성 실패"]),
  documentGroupFailed: notificationSetting("파일·폴더", "문서 묶음 생성 실패", ["문서 묶음 생성 실패"]),
  renameFailed: notificationSetting("파일·폴더", "이름 변경 실패", ["이름 변경 실패"]),
  documentListFailed: notificationSetting("기타", "문서 목록 갱신 실패", ["문서 목록 갱신 실패"]),
  notificationReadFailed: notificationSetting("기타", "알림 읽음 처리 실패", ["알림 읽음 처리 실패"]),
  server: notificationSetting("기타", "워크스페이스 서버 알림", ["알림"]),
  other: notificationSetting("기타", "기타 안내", []),
  browser: {
    ...notificationSetting("전달 방식", "브라우저 알림", [], false),
    description: "켜 둔 종류의 알림만, 탭이 백그라운드일 때 브라우저 알림으로도 보냅니다."
  }
};

export type NotificationKey = keyof typeof NOTIFICATION_SETTINGS;
export type NotificationPreferences = Record<NotificationKey, boolean>;
export const DEFAULT_NOTIFICATION_PREFERENCES = Object.fromEntries(
  Object.entries(NOTIFICATION_SETTINGS).map(([key, setting]) => [key, setting.defaultValue])
) as NotificationPreferences;

export type NotificationControls = { enabled: boolean; groups: Record<string, boolean> };
export const DEFAULT_NOTIFICATION_CONTROLS: NotificationControls = {
  enabled: true,
  groups: Object.fromEntries(Object.values(NOTIFICATION_SETTINGS).map((setting) => [setting.group, true]))
};

export function normalizeNotificationControls(value: unknown): NotificationControls {
  const saved = isRecord(value) ? value : {};
  const groups = isRecord(saved.groups) ? saved.groups : {};
  return {
    enabled: booleanValue(saved.enabled, true),
    groups: Object.fromEntries(Object.keys(DEFAULT_NOTIFICATION_CONTROLS.groups).map((group) => [group, booleanValue(groups[group], true)]))
  };
}

/** 상위 스위치는 개별 선택을 덮어쓰지 않고 실제 표시·하위 조작만 막는다. */
export function isNotificationControlEnabled(key: NotificationKey, controls: NotificationControls): boolean {
  return controls.enabled && controls.groups[NOTIFICATION_SETTINGS[key].group] !== false;
}

/** 기존 7개 설정은 유지하고, 분리된 종류는 이전 설정에서 초기값을 물려받는다. */
export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const saved = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(NOTIFICATION_SETTINGS).map(([key, setting]) => [
    key,
    booleanValue(saved[key], setting.legacyKey ? booleanValue(saved[setting.legacyKey], setting.defaultValue) : setting.defaultValue)
  ])) as NotificationPreferences;
}

export type UserPreferences = {
  // 화면 테마. system이면 OS 설정을 따른다.
  theme: ThemePreference;
  motion: MotionPreference;
  documentFont: DocumentFontPreference;
  // 채팅 composer에서 마지막으로 고른 AI 모델. 카탈로그와 대조 후에만 사용한다.
  aiModel: { provider: string; model: string } | null;
  // 채팅 질의 시 웹 검색 허용 여부(allow_web_search).
  webSearch: boolean;
  // 편집한 내용을 자동으로 저장할지 여부
  autoSave: boolean;
  editor: {
    defaultMode: EditorDefaultMode;
    lastMode: EditorMode;
    markdown: {
      lineWrapping: boolean;
      lineNumbers: boolean;
      highlightActiveLine: boolean;
    };
  };
  graph: {
    visibleKinds: {
      raw: boolean;
      source: boolean;
      concept: boolean;
    };
  };
  notifications: NotificationPreferences;
  notificationControls: NotificationControls;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "system",
  motion: "system",
  // 문서 시안(Figma 1292:5455)은 Pretendard 기준이라 기본값을 Readable Sans로 둔다
  documentFont: "readable-sans",
  aiModel: null,
  webSearch: false,
  autoSave: true,
  editor: {
    defaultMode: "last",
    lastMode: "wysiwyg",
    markdown: {
      lineWrapping: true,
      lineNumbers: false,
      highlightActiveLine: true
    }
  },
  graph: {
    visibleKinds: {
      raw: true,
      source: true,
      concept: true
    }
  },
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  notificationControls: DEFAULT_NOTIFICATION_CONTROLS
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

/** provider/model이 모두 비어있지 않은 문자열일 때만 통과시킨다. 그 외에는 null. */
function aiModelValue(value: unknown): UserPreferences["aiModel"] {
  if (!isRecord(value)) return null;
  const { provider, model } = value;
  if (typeof provider !== "string" || provider.length === 0) return null;
  if (typeof model !== "string" || model.length === 0) return null;
  return { provider, model };
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) return DEFAULT_USER_PREFERENCES;

  const editor = isRecord(value.editor) ? value.editor : {};
  const markdown = isRecord(editor.markdown) ? editor.markdown : {};
  const graph = isRecord(value.graph) ? value.graph : {};
  const visibleKinds = isRecord(graph.visibleKinds) ? graph.visibleKinds : {};
  const notifications = isRecord(value.notifications) ? value.notifications : {};

  const normalizedVisibleKinds = {
    raw: booleanValue(visibleKinds.raw, DEFAULT_USER_PREFERENCES.graph.visibleKinds.raw),
    source: booleanValue(visibleKinds.source, DEFAULT_USER_PREFERENCES.graph.visibleKinds.source),
    concept: booleanValue(visibleKinds.concept, DEFAULT_USER_PREFERENCES.graph.visibleKinds.concept)
  };

  if (!Object.values(normalizedVisibleKinds).some(Boolean)) {
    normalizedVisibleKinds.concept = true;
  }

  return {
    theme: enumValue(value.theme, ["system", "light", "dark"], DEFAULT_USER_PREFERENCES.theme),
    motion: enumValue(value.motion, ["system", "reduced", "full"], DEFAULT_USER_PREFERENCES.motion),
    documentFont: enumValue(
      value.documentFont,
      ["system-sans", "readable-sans", "serif"],
      DEFAULT_USER_PREFERENCES.documentFont
    ),
    aiModel: aiModelValue(value.aiModel),
    webSearch: booleanValue(value.webSearch, DEFAULT_USER_PREFERENCES.webSearch),
    autoSave: booleanValue(value.autoSave, DEFAULT_USER_PREFERENCES.autoSave),
    editor: {
      defaultMode: enumValue(
        editor.defaultMode,
        ["last", "wysiwyg", "markdown"],
        DEFAULT_USER_PREFERENCES.editor.defaultMode
      ),
      lastMode: enumValue(
        editor.lastMode,
        ["wysiwyg", "markdown"],
        DEFAULT_USER_PREFERENCES.editor.lastMode
      ),
      markdown: {
        lineWrapping: booleanValue(
          markdown.lineWrapping,
          DEFAULT_USER_PREFERENCES.editor.markdown.lineWrapping
        ),
        lineNumbers: booleanValue(
          markdown.lineNumbers,
          DEFAULT_USER_PREFERENCES.editor.markdown.lineNumbers
        ),
        highlightActiveLine: booleanValue(
          markdown.highlightActiveLine,
          DEFAULT_USER_PREFERENCES.editor.markdown.highlightActiveLine
        )
      }
    },
    graph: { visibleKinds: normalizedVisibleKinds },
    notifications: normalizeNotificationPreferences(notifications),
    notificationControls: normalizeNotificationControls(value.notificationControls)
  };
}

export function resolveEditorMode(preferences: UserPreferences): EditorMode {
  return preferences.editor.defaultMode === "last"
    ? preferences.editor.lastMode
    : preferences.editor.defaultMode;
}
