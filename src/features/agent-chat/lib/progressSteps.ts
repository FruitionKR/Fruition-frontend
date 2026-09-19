import type { RunStageEvent } from "@/shared/lib/runEvents";
import type { StatusStep } from "./agentData";

const LABELS: Record<string, string> = {
  "agent.routing": "질문의 의도를 파악하고 있어요.",
  query_started: "질문의 의도를 파악하고 있어요.",
  query_contextualized: "질문의 의도를 파악하고 있어요.",
  query_rewritten: "질문의 의도를 파악하고 있어요.",
  wiki_loaded: "위키를 탐색하고 있어요.",
  retrieval_markdown_loaded: "위키를 탐색하고 있어요.",
  retrieval_scored: "위키를 탐색하고 있어요.",
  seeds_selected: "위키를 탐색하고 있어요.",
  graph_traversed: "위키를 탐색하고 있어요.",
  markdown_loaded: "답변을 생성하고 있어요.",
  context_built: "답변을 생성하고 있어요.",
  answer_generated: "답변을 생성하고 있어요.",
  query_evaluating: "답변을 검토하고 있어요.",
  query_evaluated: "답변을 검토하고 있어요."
};

/** 실시간·저장된 이벤트에 같은 표시 규칙을 적용하고, 연속된 같은 단계만 합친다. */
export function buildProgressSteps(events: RunStageEvent[], isLoading: boolean): StatusStep[] {
  const labels: string[] = [];
  for (const event of events) {
    // 결과 저장은 검토가 아니다. 실제 평가 단계까지만 보여준다.
    if (event.stage === "agent.finalizing") continue;
    const label = event.stage === "agent.routed" && event.message === "질문에 답할 근거를 찾고 있어요."
      ? "질문의 의도를 파악하고 있어요."
      : LABELS[event.stage] ?? event.message;
    if (label && labels.at(-1) !== label) labels.push(label);
  }
  return labels.map((label, index) => [label, isLoading && index === labels.length - 1 ? "active" : "done"]);
}
