"use client";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

import { useEffect, useRef } from "react";
import { useMessages, useTranslations } from "next-intl";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { $prose } from "@milkdown/utils";
import { publishNotice } from "@/features/document-notifications";
import { completedMathPlugin, configureMarkdownMath, disableBlockHandle, doubleDollarMathInputRule, insertMathFromSlash } from "@/features/note-editing/model/mathInputRules";
import { configureStrikethrough, doubleTildeStrikethroughInputRule } from "@/features/note-editing/model/strikethroughInputRule";
import { cappedHeadingInputRule, disableSmallHeadingShortcuts } from "@/features/note-editing/model/headingInputRules";
import { configureMathEditor } from "@/features/note-editing/model/mathEditorConfig";
import { createExternalImageGuard } from "@/features/note-editing/model/externalImageGuard";
import { buildSlashMenuLabels } from "@/features/note-editing/model/slashMenuLabels";
// 노트 편집기와 같은 Milkdown 테마·색 토큰을 쓴다.
import styles from "@/features/note-editing/ui/NoteEditor.module.css";

/**
 * 위키 페이지 본문 Markdown 편집기. 노트 편집기(NoteEditor)의 Milkdown 설정을 따르되 문서 전용인
 * 자동 저장·편집 잠금·이미지 첨부는 두지 않는다(위키 페이지는 첨부 저장소가 없다). 저장은 부모가 draft로 한다.
 */
export function WikiPageEditor({ initialMarkdown, onChange }: { initialMarkdown: string; onChange: (markdown: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialMarkdownRef = useRef(initialMarkdown);
  const t = useTranslations("wiki.pageEditing");
  const editorMessages = useMessages().documents.editor;
  // 편집기는 한 번만 만들므로 알림 문구는 ref로 최신 언어를 읽는다. 메뉴·안내 문구는 만들 때의 언어를 쓴다.
  const blockedNoticeRef = useRef({ title: "", message: "" });
  blockedNoticeRef.current = { title: t("externalImageBlockedTitle"), message: editorMessages.image.externalBlockedMessage };
  const editorMessagesRef = useRef(editorMessages);
  editorMessagesRef.current = editorMessages;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let isDisposed = false;
    // NoteEditor와 같은 이유로 인스턴스마다 전용 host를 둔다(create/destroy가 비동기라 DOM이 겹친다).
    const host = document.createElement("div");
    root.appendChild(host);
    const externalImageGuard = $prose(() => createExternalImageGuard(() => {
      publishNotice({ kind: "failed", notificationKey: "externalImageBlocked", ...blockedNoticeRef.current });
    }));
    const messages = editorMessagesRef.current;
    const slashMenuLabels = buildSlashMenuLabels(messages.slashMenu);

    const crepe = new Crepe({
      root: host,
      defaultValue: initialMarkdownRef.current,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.TopBar]: false,
        [CrepeFeature.ImageBlock]: false
      },
      featureConfigs: {
        [CrepeFeature.BlockEdit]: {
          blockHandle: { shouldShow: () => false },
          buildMenu: (builder) => {
            const math = builder.getGroup("advanced").group.items.find((item) => item.key === "math");
            if (math) math.onRun = insertMathFromSlash;
          },
          ...slashMenuLabels,
          // 이미지 블록 기능을 끄므로 메뉴에서도 뺀다.
          advancedGroup: { ...slashMenuLabels.advancedGroup, image: null }
        },
        [CrepeFeature.Placeholder]: { text: messages.bodyPlaceholder, mode: "doc" }
      }
    }).on((listener) => {
      listener.markdownUpdated((_ctx, nextMarkdown, previousMarkdown) => {
        if (isDisposed || nextMarkdown === previousMarkdown) return;
        onChangeRef.current(nextMarkdown);
      });
    });
    crepe.editor
      .use(doubleDollarMathInputRule)
      .use(completedMathPlugin)
      .use(doubleTildeStrikethroughInputRule)
      .use(cappedHeadingInputRule)
      .use(externalImageGuard)
      .config((ctx) => {
        configureMarkdownMath(ctx);
        configureStrikethrough(ctx);
        disableSmallHeadingShortcuts(ctx);
        configureMathEditor(ctx, messages.math);
        disableBlockHandle(ctx);
      });
    const ready = crepe.create();

    return () => {
      isDisposed = true;
      host.hidden = true;
      void ready
        .catch(() => {})
        .then(() => crepe.destroy())
        .catch(() => {})
        .finally(() => host.remove());
    };
  }, []);

  return (
    <div className={styles["note-editor-shell"]}>
      <div ref={rootRef} className={styles["note-wysiwyg-editor"]} />
    </div>
  );
}
