import type { AiModel } from "@/entities/ai";
import { requestAgentTurn } from "@/features/agent-chat";
import { AGENT_TURN_CHAT_MODE, buildAgentTurnRequest } from "@/features/agent-chat/lib/agentTurn";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import type { DocumentQuestionHandlers } from "@/features/agent-chat/model/useChatThread";
import { sendTurnDroppingOpenDocument } from "./composerDocuments";

/**
 * 채팅 탭의 문서 질문을 보낸다. 작업 탭처럼 자동으로 실은 보기 권한 문서가 거절되면 빼고 한 번 더 보낸다.
 * 응답(result)은 쓰지 않는다. 답은 세션 메시지로 보이고, 편집안이 오더라도 적용하는 경로가 없다.
 */
export function sendChatDocumentQuestion(
  { question, context, referenceDocumentIds, autoDocumentId, model, sessionId, allowWebSearch, onOpenDocumentDropped }: {
    question: string;
    context: ActiveMarkdownEditContext | null;
    referenceDocumentIds: string[];
    autoDocumentId: string | null;
    model: AiModel;
    sessionId: string;
    allowWebSearch: boolean;
    onOpenDocumentDropped: (documentId: string) => void;
  },
  { signal, onAccepted, onStage }: DocumentQuestionHandlers
): Promise<unknown> {
  let isAccepted = false;
  return sendTurnDroppingOpenDocument({
    referenceDocumentIds,
    autoDocumentId,
    hasStarted: () => isAccepted,
    send: (documentIds) => requestAgentTurn(buildAgentTurnRequest(question, context, {
      mode: AGENT_TURN_CHAT_MODE,
      sessionId,
      selectedModel: { provider: model.provider, model: model.model },
      selectedPairIds: [],
      allowWebSearch,
      referenceDocumentIds: documentIds
    }), {
      signal,
      onStage,
      onAccepted: (requestId) => {
        isAccepted = true;
        onAccepted(requestId);
        if (autoDocumentId !== null && !documentIds.includes(autoDocumentId)) onOpenDocumentDropped(autoDocumentId);
      }
    })
  });
}
