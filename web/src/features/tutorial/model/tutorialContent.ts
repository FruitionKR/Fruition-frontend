/**
 * 서비스 사용 방법 튜토리얼의 순서와 구조. 문구는 언어별 메시지(src/shared/i18n/messages/{ko,en}/tutorialContent.json)에 있다.
 * 섹션 문구 키: sections.<sectionId>.title·summary, 단계 문구 키: steps.<stepId>.title·body.
 * id는 섹션·단계 전체에서 겹치지 않는 kebab-case이고, 키 일치는 tests/tutorialContent.test.mjs가 확인한다.
 * 단계 image는 화면 캡처 파일 이름(<stepId>.webp)만 쓰고, 경로는 tutorialImageSrc가 언어별로 조립한다.
 * 파일은 public/tutorial/{ko,en}/에 있고 scripts/tutorial-screenshots/로 다시 만든다.
 */

export type TutorialIcon =
  | "start"
  | "document"
  | "upload"
  | "pdf"
  | "wiki"
  | "graph"
  | "chat"
  | "agent"
  | "skill"
  | "meeting"
  | "import"
  | "settings"
  | "language"
  | "log";

export type TutorialStep = { id: string; icon?: TutorialIcon; image?: string };

/** 캡처 파일의 픽셀 크기. 모든 캡처를 같은 16:9 캔버스로 저장해 카드가 이미지 로드 전후로 밀리지 않게 한다(CLS). */
export const TUTORIAL_IMAGE_SIZE = { width: 960, height: 540 } as const;

/** 단계 캡처 주소. 파일 이름만 받아 화면 언어 폴더를 붙인다. */
export function tutorialImageSrc(locale: string, image: string): string {
  return `/tutorial/${locale}/${image}`;
}

export type TutorialSection = { id: string; icon: TutorialIcon; steps: TutorialStep[] };

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    id: "getting-started",
    icon: "start",
    steps: [
      { id: "choose-workspace", image: "choose-workspace.webp" },
      { id: "wiki-basics", icon: "wiki" },
      { id: "screen-layout", image: "screen-layout.webp" },
      { id: "chat-panel-tabs", icon: "chat", image: "chat-panel-tabs.webp" }
    ]
  },
  {
    id: "documents",
    icon: "document",
    steps: [
      { id: "write-note", image: "write-note.webp" },
      { id: "upload-files", icon: "upload", image: "upload-files.webp" },
      { id: "organize-folders", image: "organize-folders.webp" },
      { id: "edit-permissions", image: "edit-permissions.webp" },
      { id: "delete-restore", image: "delete-restore.webp" }
    ]
  },
  {
    id: "pdf-conversion",
    icon: "pdf",
    steps: [
      { id: "convert-pdf", image: "convert-pdf.webp" },
      { id: "track-conversion" },
      { id: "converted-under-source", image: "converted-under-source.webp" },
      { id: "describe-figures", image: "describe-figures.webp" }
    ]
  },
  {
    id: "wiki-ingest",
    icon: "wiki",
    steps: [
      { id: "markdown-auto-ingest", icon: "upload", image: "markdown-auto-ingest.webp" },
      { id: "converted-ingest-prompt", icon: "pdf", image: "converted-ingest-prompt.webp" },
      { id: "choose-ingest", image: "choose-ingest.webp" },
      { id: "wiki-status-labels" },
      { id: "refresh-wiki", image: "refresh-wiki.webp" }
    ]
  },
  {
    id: "graph",
    icon: "graph",
    steps: [{ id: "graph-nodes", image: "graph-nodes.webp" }, { id: "graph-explore", image: "graph-explore.webp" }]
  },
  {
    id: "chat",
    icon: "chat",
    steps: [
      { id: "ask-question", image: "ask-question.webp" },
      { id: "answer-sources", image: "answer-sources.webp" },
      { id: "note-evidence-notice", icon: "wiki", image: "note-evidence-notice.webp" },
      { id: "save-chat", image: "save-chat.webp" }
    ]
  },
  {
    id: "agent-tasks",
    icon: "agent",
    steps: [
      { id: "request-task", image: "request-task.webp" },
      { id: "review-edit-proposals" },
      { id: "approve-plan" },
      { id: "auto-approval", icon: "settings", image: "auto-approval.webp" }
    ]
  },
  {
    id: "skills",
    icon: "skill",
    steps: [
      { id: "browse-skills", image: "browse-skills.webp" },
      { id: "create-skill", image: "create-skill.webp" },
      { id: "run-skill" },
      { id: "save-request-as-skill", icon: "agent" }
    ]
  },
  {
    id: "meetings",
    icon: "meeting",
    steps: [
      { id: "record-meeting", image: "record-meeting.webp" },
      { id: "upload-recording", icon: "upload", image: "upload-recording.webp" },
      { id: "create-meeting-notes" },
      { id: "past-meetings", image: "past-meetings.webp" }
    ]
  },
  {
    id: "mcp-connection",
    icon: "agent",
    steps: [
      { id: "mcp-external-ai-role" },
      { id: "mcp-add-server" },
      { id: "mcp-login-consent" },
      { id: "mcp-check-tools" },
      { id: "mcp-manage-connection", icon: "settings" }
    ]
  },
  {
    id: "notion-import",
    icon: "import",
    steps: [{ id: "export-from-notion" }, { id: "preview-import", image: "preview-import.webp" }, { id: "after-import", icon: "wiki" }]
  },
  {
    id: "logs-notifications",
    icon: "log",
    steps: [
      { id: "view-logs", image: "view-logs.webp" },
      { id: "rollback-operation", image: "rollback-operation.webp" },
      { id: "check-notifications", image: "check-notifications.webp" }
    ]
  },
  {
    id: "settings",
    icon: "settings",
    steps: [
      { id: "change-language", icon: "language", image: "change-language.webp" },
      { id: "auto-ingest-switches", icon: "wiki", image: "auto-ingest-switches.webp" },
      { id: "manage-members", image: "manage-members.webp" }
    ]
  }
];
