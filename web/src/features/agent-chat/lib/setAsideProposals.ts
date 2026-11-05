import type { AgentTurnRequest, AgentTurnResponse } from "./agentTurn";

/** 후속 요청에 자리를 내준, 아직 결정하지 않은 편집안·새 문서 초안. 원문 기준이 요청에만 있어 요청과 함께 둔다. */
export type SetAsideProposal = { request: AgentTurnRequest; response: AgentTurnResponse };
export type SetAsideProposals = ReadonlyMap<string, SetAsideProposal>;

/** 제안을 맨 뒤에 담은 새 목록. 내려 둘 제안이 없으면 그대로 돌려준다. */
export function setAsideProposal(proposals: SetAsideProposals, proposal: SetAsideProposal | null): SetAsideProposals {
  if (!proposal) return proposals;
  return new Map([...proposals, [proposal.response.requestId, proposal]]);
}

/** 내려 둔 제안을 꺼내고, 그 자리에 지금 열려 있던 제안을 내려 둔다. */
export function takeSetAsideProposal(
  proposals: SetAsideProposals,
  turnId: string,
  current: SetAsideProposal | null
): { taken: SetAsideProposal | null; rest: SetAsideProposals } {
  const taken = proposals.get(turnId) ?? null;
  if (!taken) return { taken: null, rest: proposals };
  return { taken, rest: setAsideProposal(new Map([...proposals].filter(([id]) => id !== turnId)), current) };
}
