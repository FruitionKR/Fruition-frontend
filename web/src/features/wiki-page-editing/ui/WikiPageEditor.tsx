"use client";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

import { useEffect, useRef } from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { $prose } from "@milkdown/utils";
import { publishNotice } from "@/features/document-notifications";
import { completedMathPlugin, configureMarkdownMath, disableBlockHandle, doubleDollarMathInputRule, insertMathFromSlash } from "@/features/note-editing/model/mathInputRules";
import { configureStrikethrough, doubleTildeStrikethroughInputRule } from "@/features/note-editing/model/strikethroughInputRule";
import { cappedHeadingInputRule, disableSmallHeadingShortcuts } from "@/features/note-editing/model/headingInputRules";
import { configureMathEditor } from "@/features/note-editing/model/mathEditorConfig";
import { createExternalImageGuard } from "@/features/note-editing/model/externalImageGuard";
import { NOTE_BODY_PLACEHOLDER, SLASH_MENU_LABELS } from "@/features/note-editing/model/slashMenuLabels";
import { EXTERNAL_IMAGE_BLOCKED_MESSAGE } from "@/shared/lib/markdown/externalResources";
// 노트 편집기와 같은 Milkdown 테마·색 토큰을 쓴다.
import styles from "@/features/note-editing/ui/NoteEditor.module.css";

const externalImageGuard = $prose(() => createExternalImageGuard(() => {
  publishNotice({ kind: "failed", title: "외부 이미지 차단", message: EXTERNAL_IMAGE_BLOCKED_MESSAGE });
}));

/**
 * 위키 페이지 본문 Markdown 편집기. 노트 편집기(NoteEditor)의 Milkdown 설정을 따르되 문서 전용인
 * 자동 저장·편집 잠금·이미지 첨부는 두지 않는다(위키 페이지는 첨부 저장소가 없다). 저장은 부모가 draft로 한다.
 */
export function WikiPageEditor({ initialMarkdown, onChange }: { initialMarkdown: string; onChange: (markdown: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialMarkdownRef = useRef(initialMarkdown);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let isDisposed = false;
    // NoteEditor와 같은 이유로 인스턴스마다 전용 host를 둔다(create/destroy가 비동기라 DOM이 겹친다).
    const host = document.createElement("div");
    root.appendChild(host);

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
          ...SLASH_MENU_LABELS,
          // 이미지 블록 기능을 끄므로 메뉴에서도 뺀다.
          advancedGroup: { ...SLASH_MENU_LABELS.advancedGroup, image: null }
        },
        [CrepeFeature.Placeholder]: { text: NOTE_BODY_PLACEHOLDER, mode: "doc" }
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
        configureMathEditor(ctx);
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
