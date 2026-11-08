export type StatusStepState = "done" | "active" | "pending";
export type StatusStep = [label: string, state: StatusStepState];

export function buildStatusSteps(isLoading: boolean, hasResponse: boolean, t: AgentChatTranslator): StatusStep[] {
  return [
    [t("status.steps.analyze"), isLoading || hasResponse ? "done" : "pending"],
    [t("status.steps.searchWiki"), hasResponse ? "done" : isLoading ? "active" : "pending"],
    [t("status.steps.writeAnswer"), hasResponse ? "done" : "pending"]
  ];
}

export function buildDocumentCommandSteps(
  action: DocumentCommandAction,
  isLoading: boolean,
  hasResponse: boolean,
  t: AgentChatTranslator
): StatusStep[] {
  return [
    [t("status.steps.analyze"), isLoading || hasResponse ? "done" : "pending"],
    [t("status.steps.generate"), hasResponse ? "done" : isLoading ? "active" : "pending"],
    [documentCommandLabel(action, t), hasResponse ? "done" : "pending"]
  ];
}

function documentCommandLabel(action: DocumentCommandAction, t: AgentChatTranslator): string {
  if (action === "markdown_edit") return t("status.command.markdownEdit");
  if (action === "markdown_create") return t("status.command.markdownCreate");
  if (action === "folder_organize") return t("status.command.folderOrganize");
  if (action === "workspace_workflow") return t("status.command.workspaceWorkflow");
  return t("status.command.skill");
}
import type { AgentChatTranslator } from "./agentChatTranslator";
import type { DocumentCommandAction } from "./agentTurn";

/** 말풍선 상태 목록의 제목. 취소는 작업 탭의 "취소됨"과 맞춰 적는다. */
export function messageStatusTitle(status: string, t: AgentChatTranslator): string {
  if (status === "pending") return t("status.title.pending");
  if (status === "completed") return t("status.title.completed");
  if (status === "cancelled") return t("status.title.cancelled");
  return t("status.title.ended");
}
