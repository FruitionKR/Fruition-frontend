import type { RunStageEvent } from "@/shared/lib/runEventStream";
import type { AgentChatTranslator } from "./agentChatTranslator";
import type { StatusStep } from "./statusSteps";

type ProgressStage = "intent" | "wiki" | "answering" | "reviewing";

/** 진행 단계 → agentChat.progress 아래 메시지 키. 모르는 단계는 서버가 보낸 문구를 그대로 쓴다. */
const STAGES: Record<string, ProgressStage> = {
  "agent.routing": "intent",
  query_started: "intent",
  query_contextualized: "intent",
  query_rewritten: "intent",
  wiki_loaded: "wiki",
  retrieval_markdown_loaded: "wiki",
  retrieval_scored: "wiki",
  seeds_selected: "wiki",
  graph_traversed: "wiki",
  markdown_loaded: "answering",
  context_built: "answering",
  answer_generated: "answering",
  query_evaluating: "reviewing",
  query_evaluated: "reviewing"
};

/** agent.routed 이벤트에 서버가 붙이는 고정 문구(영어로 요청하면 영어 문장). 의도 파악 단계와 같게 보여 준다. */
const ROUTED_SEARCH_MESSAGES = ["질문에 답할 근거를 찾고 있어요.", "Looking for evidence to answer your question."];

/** 실시간·저장된 이벤트에 같은 표시 규칙을 적용하고, 연속된 같은 단계만 합친다. */
export function buildProgressSteps(events: RunStageEvent[], isLoading: boolean, t: AgentChatTranslator): StatusStep[] {
  const labels: string[] = [];
  for (const event of events) {
    // 결과 저장은 검토가 아니다. 실제 평가 단계까지만 보여준다.
    if (event.stage === "agent.finalizing") continue;
    const stage = event.stage === "agent.routed" && ROUTED_SEARCH_MESSAGES.includes(event.message) ? "intent" : STAGES[event.stage];
    const label = stage ? t(`progress.${stage}`) : event.message;
    if (label && labels.at(-1) !== label) labels.push(label);
  }
  return labels.map((label, index) => [label, isLoading && index === labels.length - 1 ? "active" : "done"]);
}
