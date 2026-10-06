import { Fragment, Slice, type Node as ProseNode } from "@milkdown/prose/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { classifyImageSource } from "@/shared/lib/externalResources";

/**
 * 편집기에 외부 이미지가 새로 들어오지 못하게 막는다(이슈 #77).
 * 기존 본문에 이미 있던 외부 이미지는 지우지 않고 자리 표시 그림으로만 보여준다.
 */

// Crepe의 인라인 이미지("image")와 이미지 블록("image-block")
const IMAGE_NODE_TYPES = new Set(["image", "image-block"]);

/** 본문 전체를 프로그램으로 바꾸는 트랜잭션(AI 편집 적용 등)에 붙인다. 사용자 입력이 아니므로 막지 않는다. */
export const ALLOW_EXTERNAL_IMAGES_META = "allowExternalImages";

function isExternalImage(node: ProseNode): boolean {
  const src = node.attrs.src;
  return IMAGE_NODE_TYPES.has(node.type.name) && typeof src === "string" && classifyImageSource(src).kind === "external";
}

/** 문서나 조각 안의 외부 이미지 노드 수. */
export function countExternalImages(content: Fragment | ProseNode): number {
  let count = 0;
  content.descendants((node) => {
    if (isExternalImage(node)) count += 1;
  });
  return count;
}

/** 외부 이미지 노드만 뺀 조각. 나머지 글과 구조는 그대로 둔다. */
export function stripExternalImages(fragment: Fragment): Fragment {
  const children: ProseNode[] = [];
  fragment.forEach((child) => {
    if (isExternalImage(child)) return;
    children.push(child.isLeaf ? child : child.copy(stripExternalImages(child.content)));
  });
  return Fragment.fromArray(children);
}

// 단계가 외부 이미지를 넣을 수 있는지 먼저 본다. 해당할 때만 문서 전체를 세어 입력마다 전체를 훑지 않는다.
function stepMayInsertExternalImage(step: unknown): boolean {
  const { slice, attr, value } = step as { slice?: Slice; attr?: string; value?: unknown };
  if (slice) return countExternalImages(slice.content) > 0;
  return attr === "src" && typeof value === "string" && classifyImageSource(value).kind === "external";
}

// undo/redo는 사용자가 지운 기존 외부 이미지를 되돌릴 수 있게 허용한다.
// NoteEditor가 history plugin을 교체하므로 key를 직접 import하지 않고 state에서 찾는다.
function isHistoryTransaction(tr: Transaction, state: EditorState): boolean {
  const history = state.plugins.find((plugin) => (plugin as unknown as { key?: string }).key?.startsWith("history$"));
  return Boolean(history && tr.getMeta(history));
}

/** 이 트랜잭션이 외부 이미지 수를 늘리는지. 이동·삭제·undo·프로그램 교체는 허용한다. */
export function addsExternalImage(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || tr.getMeta(ALLOW_EXTERNAL_IMAGES_META) || isHistoryTransaction(tr, state)) return false;
  if (!tr.steps.some(stepMayInsertExternalImage)) return false;
  return countExternalImages(tr.doc) > countExternalImages(state.doc);
}

/** 입력 규칙(`![](https://…)`)·드롭·이미지 링크 입력 등 모든 경로에서 외부 이미지가 늘어나는 변경을 거부한다. */
export function createExternalImageGuard(onBlocked: () => void): Plugin {
  return new Plugin({
    key: new PluginKey("externalImageGuard"),
    filterTransaction(tr, state) {
      if (!addsExternalImage(tr, state)) return true;
      onBlocked();
      return false;
    }
  });
}

/**
 * 붙여넣기 처리기. Milkdown clipboard plugin보다 먼저 돌아야 한다(편집기 direct prop으로 등록).
 * Milkdown은 markdown 글을 붙여넣을 때 노드를 현재 document의 DOM으로 직렬화했다가 다시 읽는데,
 * 그 순간 만들어진 <img>가 화면에 붙지 않아도 외부 주소를 요청한다. 그래서 노드로만 파싱해 먼저 검사한다.
 * 외부 이미지가 있으면 그 노드만 빼고 붙여넣는다.
 */
export function createExternalImagePasteHandler(
  parseMarkdown: (markdown: string) => ProseNode | null | undefined,
  onBlocked: () => void
) {
  return (view: EditorView, event: ClipboardEvent, slice: Slice): boolean => {
    const data = event.clipboardData;
    if (!data || view.state.selection.$from.parent.type.spec.code) return false;
    // VS Code에서 복사한 글은 Milkdown이 코드 블록으로 넣는다(이미지가 생기지 않는다).
    if (data.getData("vscode-editor-data")) return false;
    const html = data.getData("text/html");
    const text = data.getData("text/plain");
    let content: Fragment | null = null;
    if (html) {
      // HTML은 ProseMirror가 화면 밖 문서에서 읽어 둔 slice를 그대로 검사한다
      content = slice.content;
    } else if (text) {
      try {
        content = parseMarkdown(text)?.content ?? null;
      } catch {
        content = null;
      }
    }
    if (!content || countExternalImages(content) === 0) return false;

    onBlocked();
    const stripped = stripExternalImages(content);
    const next = html ? new Slice(stripped, slice.openStart, slice.openEnd) : Slice.maxOpen(stripped);
    try {
      view.dispatch(view.state.tr.replaceSelection(next).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
    } catch {
      // 노드를 뺀 조각이 이 자리에 맞지 않으면 붙여넣지 않는다. 안내는 이미 했다.
    }
    return true;
  };
}

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * 편집기 이미지 자리에 대신 보여줄 그림(data:image/svg+xml). 네트워크 요청이 없다.
 * <img> 안의 SVG는 문서 웹폰트를 쓰지 못하므로 시스템 한글 서체를 지정한다.
 */
export function blockedImagePlaceholderUrl(host: string | null): string {
  const label = host ? `외부 이미지는 표시하지 않습니다 · ${host}` : "표시할 수 없는 이미지입니다";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="48" viewBox="0 0 560 48">`
    + `<rect x="0.5" y="0.5" width="559" height="47" rx="6" fill="none" stroke="#4a4a4a" stroke-dasharray="4 3"/>`
    + `<text x="16" y="29" fill="#9a9a9a" font-size="14" font-family="-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif">${escapeXml(label)}</text>`
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
