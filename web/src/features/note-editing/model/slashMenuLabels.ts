import type koDocuments from "@/shared/i18n/messages/ko/documents.json";

type SlashMenuMessages = typeof koDocuments.editor.slashMenu;

/** '/' 슬래시 메뉴 라벨. 문구는 documents.editor.slashMenu 메시지다. */
export function buildSlashMenuLabels(messages: SlashMenuMessages) {
  return {
    textGroup: {
      label: messages.textGroup,
      text: { label: messages.text },
      h1: { label: messages.h1 },
      h2: { label: messages.h2 },
      h3: { label: messages.h3 },
      // 본문과 같거나 작은 h4~h6은 만들지 않는다(model/headingInputRules.ts).
      h4: null,
      h5: null,
      h6: null,
      quote: { label: messages.quote },
      divider: { label: messages.divider }
    },
    listGroup: {
      label: messages.listGroup,
      bulletList: { label: messages.bulletList },
      orderedList: { label: messages.orderedList },
      taskList: { label: messages.taskList }
    },
    advancedGroup: {
      label: messages.advancedGroup,
      image: { label: messages.image },
      codeBlock: { label: messages.codeBlock },
      table: { label: messages.table },
      math: { label: messages.math }
    }
  } as const;
}
