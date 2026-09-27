import type { ChatMessageResponse } from "@/entities/chat/model/chat";

export type ChatMessageGroup = {
  key: string;
  pairId: string | null;
  messages: ChatMessageResponse[];
};

export function groupMessagesByPair(messages: ChatMessageResponse[]): ChatMessageGroup[] {
  const groups: ChatMessageGroup[] = [];
  const groupByPairId = new Map<string, ChatMessageGroup>();

  for (const message of messages) {
    if (!message.pair_id) {
      groups.push({ key: message.id, pairId: null, messages: [message] });
      continue;
    }

    let group = groupByPairId.get(message.pair_id);
    if (!group) {
      group = { key: message.pair_id, pairId: message.pair_id, messages: [] };
      groupByPairId.set(message.pair_id, group);
      groups.push(group);
    }
    group.messages.push(message);
  }

  return groups;
}
