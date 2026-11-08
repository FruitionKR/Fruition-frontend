/**
 * 서비스 사용 방법 튜토리얼의 순서와 구조. 문구는 언어별 메시지(src/shared/i18n/messages/{ko,en}/tutorialContent.json)에 있다.
 * 섹션 문구 키: sections.<sectionId>.title·summary, 단계 문구 키: steps.<stepId>.title·body.
 * id는 섹션·단계 전체에서 겹치지 않는 kebab-case이고, 키 일치는 tests/tutorialContent.test.mjs가 확인한다.
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

export type TutorialStep = { id: string; icon?: TutorialIcon };

export type TutorialSection = { id: string; icon: TutorialIcon; steps: TutorialStep[] };

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    id: "getting-started",
    icon: "start",
    steps: [{ id: "choose-workspace" }, { id: "screen-layout" }, { id: "chat-panel-tabs", icon: "chat" }]
  },
  {
    id: "documents",
    icon: "document",
    steps: [
      { id: "write-note" },
      { id: "upload-files", icon: "upload" },
      { id: "organize-folders" },
      { id: "edit-permissions" },
      { id: "delete-restore" }
    ]
  },
  {
    id: "pdf-conversion",
    icon: "pdf",
    steps: [{ id: "convert-pdf" }, { id: "track-conversion" }, { id: "converted-under-source" }, { id: "describe-figures" }]
  },
  {
    id: "wiki-ingest",
    icon: "wiki",
    steps: [
      { id: "markdown-auto-ingest", icon: "upload" },
      { id: "converted-ingest-prompt", icon: "pdf" },
      { id: "choose-ingest" },
      { id: "wiki-status-labels" },
      { id: "refresh-wiki" }
    ]
  },
  {
    id: "graph",
    icon: "graph",
    steps: [{ id: "graph-nodes" }, { id: "graph-explore" }, { id: "edit-wiki-page", icon: "wiki" }]
  },
  {
    id: "chat",
    icon: "chat",
    steps: [{ id: "ask-question" }, { id: "answer-sources" }, { id: "note-evidence-notice", icon: "wiki" }, { id: "save-chat" }]
  },
  {
    id: "agent-tasks",
    icon: "agent",
    steps: [{ id: "request-task" }, { id: "review-edit-proposals" }, { id: "approve-plan" }, { id: "auto-approval", icon: "settings" }]
  },
  {
    id: "skills",
    icon: "skill",
    steps: [{ id: "browse-skills" }, { id: "create-skill" }, { id: "run-skill" }, { id: "save-request-as-skill", icon: "agent" }]
  },
  {
    id: "meetings",
    icon: "meeting",
    steps: [{ id: "record-meeting" }, { id: "upload-recording", icon: "upload" }, { id: "create-meeting-notes" }, { id: "past-meetings" }]
  },
  {
    id: "notion-import",
    icon: "import",
    steps: [{ id: "export-from-notion" }, { id: "preview-import" }, { id: "after-import", icon: "wiki" }]
  },
  {
    id: "logs-notifications",
    icon: "log",
    steps: [{ id: "view-logs" }, { id: "rollback-operation" }, { id: "check-notifications" }]
  },
  {
    id: "settings",
    icon: "settings",
    steps: [{ id: "change-language", icon: "language" }, { id: "auto-ingest-switches", icon: "wiki" }, { id: "manage-members" }]
  }
];
