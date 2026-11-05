import { Fragment, type Node } from "@milkdown/prose/model";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/prose/state";

type DocChange = { fromA: number; toA: number; fromB: number; toB: number; inline: boolean };

/** 편집기는 제목 id를 글자에서 만들어 넣지만 parser 결과의 id는 비어 있다. 저장되지 않는 값이라 비교에서 뺀다. */
function withoutHeadingIds(node: Node): Node {
  if (node.inlineContent) {
    return node.type.name === "heading" ? node.type.create({ ...node.attrs, id: "" }, node.content, node.marks) : node;
  }
  const children: Node[] = [];
  node.forEach((child) => children.push(withoutHeadingIds(child)));
  return node.copy(Fragment.fromArray(children));
}

function childOffsets(node: Node, contentStart: number): number[] {
  const offsets = [contentStart];
  node.forEach((child) => offsets.push(offsets[offsets.length - 1] + child.nodeSize));
  return offsets;
}

function textSimilarity(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  return prefix + suffix;
}

/** 선택 끝점이 들어 있는 자식과 짝이 될 자식을 찾는다. 같은 내용을 먼저, 없으면 가장 닮은 것을, 같으면 가까운 쪽을 고른다. */
function findPartner(child: Node, parent: Node, from: number, to: number, expected: number): number {
  let best = -1;
  let bestScore = -1;
  let bestDistance = Infinity;
  for (let index = from; index < to; index += 1) {
    const candidate = parent.child(index);
    if (!child.sameMarkup(candidate)) continue;
    const score = child.eq(candidate) ? Infinity : textSimilarity(child.textContent, candidate.textContent);
    const distance = Math.abs(index - expected);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = index;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
}

function collectInlineChange(a: Node, b: Node, startA: number, startB: number, changes: DocChange[]) {
  const start = a.content.findDiffStart(b.content, startA);
  const end = a.content.findDiffEnd(b.content, startA + a.content.size, startB + b.content.size);
  if (start === null || !end) return;
  const shiftB = startB - startA;
  // 반복되는 내용에서는 끝 비교가 시작보다 앞설 수 있어 겹친 만큼 뒤로 민다.
  const overlap = Math.max(0, start - Math.min(end.a, end.b - shiftB));
  changes.push({ fromA: start, toA: end.a + overlap, fromB: start + shiftB, toB: end.b + overlap, inline: true });
}

/**
 * a를 b로 바꾸는 구간을 앞에서부터 모은다. 선택 끝점이 있는 자식은 짝을 찾아 구간에서 빼고 그 안으로 내려가므로,
 * 앞뒤가 모두 바뀌어도 끝점이 있는 줄은 교체되지 않는다.
 */
function collectChanges(a: Node, b: Node, startA: number, startB: number, points: number[], changes: DocChange[]) {
  if (a.inlineContent) {
    collectInlineChange(a, b, startA, startB, changes);
    return;
  }
  const limit = Math.min(a.childCount, b.childCount);
  let prefix = 0;
  while (prefix < limit && a.child(prefix).eq(b.child(prefix))) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && a.child(a.childCount - 1 - suffix).eq(b.child(b.childCount - 1 - suffix))) suffix += 1;

  const offsetsA = childOffsets(a, startA);
  const offsetsB = childOffsets(b, startB);
  const endIndexA = a.childCount - suffix;
  const endIndexB = b.childCount - suffix;
  let indexA = prefix;
  let indexB = prefix;
  const pushGap = (toIndexA: number, toIndexB: number) => {
    if (indexA === toIndexA && indexB === toIndexB) return;
    changes.push({ fromA: offsetsA[indexA], toA: offsetsA[toIndexA], fromB: offsetsB[indexB], toB: offsetsB[toIndexB], inline: false });
  };

  for (let index = prefix; index < endIndexA; index += 1) {
    if (!points.some((point) => offsetsA[index] < point && point < offsetsA[index + 1])) continue;
    const child = a.child(index);
    const partner = findPartner(child, b, indexB, endIndexB, indexB + index - indexA);
    if (partner < 0) continue;
    pushGap(index, partner);
    if (!child.eq(b.child(partner))) {
      collectChanges(child, b.child(partner), offsetsA[index] + 1, offsetsB[partner] + 1, points, changes);
    }
    indexA = index + 1;
    indexB = partner + 1;
  }
  pushGap(endIndexA, endIndexB);
}

/**
 * 서버가 합친 문서로 바꾸는 트랜잭션을 만든다. 달라진 구간만 바꾸고 선택 끝점이 있는 줄은 남겨 캐럿이 다른 줄로 옮겨 가지 않는다.
 * 그 줄 자체가 바뀌어 끝점이 교체 구간 안에 들면 ProseMirror 매핑은 구간 끝으로 보내므로, 줄 안의 같은 칸으로 되돌린다.
 */
export function buildServerMergeTransaction(state: EditorState, nextDoc: Node): Transaction {
  const { doc, selection, tr } = state;
  const changes: DocChange[] = [];
  collectChanges(withoutHeadingIds(doc), withoutHeadingIds(nextDoc), 0, 0, [selection.from, selection.to], changes);
  // 앞 구간의 위치가 밀리지 않게 뒤에서부터 적용한다.
  [...changes].reverse().forEach((change) => tr.replace(change.fromA, change.toA, nextDoc.slice(change.fromB, change.toB)));

  if (!(selection instanceof TextSelection)) return tr;
  const inlineChangeAt = (point: number) => changes.find((change) => change.inline
    && change.fromA <= point
    && (point < change.toA || change.fromA === change.toA && point === change.fromA));
  const remap = (point: number) => {
    const change = inlineChangeAt(point);
    if (!change) return tr.mapping.map(point);
    return tr.mapping.map(change.fromA, -1) + Math.min(point - change.fromA, change.toB - change.fromB);
  };
  if (inlineChangeAt(selection.anchor) || inlineChangeAt(selection.head)) {
    tr.setSelection(TextSelection.between(tr.doc.resolve(remap(selection.anchor)), tr.doc.resolve(remap(selection.head))));
  }
  return tr;
}

/** 저장을 보낸 본문(sentDoc)에서 지금 편집기(currentDoc)까지 달라진 줄을 서버 문서(nextDoc)에 옮겨 놓는다. */
export function rebaseLocalEdits(sentDoc: Node, currentDoc: Node, nextDoc: Node): Node {
  const sent = withoutHeadingIds(sentDoc);
  const current = withoutHeadingIds(currentDoc);
  const next = withoutHeadingIds(nextDoc);
  const limit = Math.min(sent.childCount, current.childCount);
  let start = 0;
  while (start < limit && sent.child(start).eq(current.child(start))) start += 1;
  let suffix = 0;
  while (suffix < limit - start && sent.child(sent.childCount - 1 - suffix).eq(current.child(current.childCount - 1 - suffix))) suffix += 1;
  if (start === sent.childCount && start === current.childCount) return nextDoc;

  let sentEnd = sent.childCount - suffix;
  let currentEnd = current.childCount - suffix;
  // 줄만 새로 넣었으면 옮길 자리를 찾을 기준이 없으니 이웃한 줄을 함께 옮긴다.
  if (start === sentEnd) {
    if (start > 0) start -= 1;
    else {
      sentEnd += 1;
      currentEnd += 1;
    }
  }
  const length = sentEnd - start;
  const matches = (at: number) => Array.from({ length }, (_, i) => i).every((i) => sent.child(start + i).eq(next.child(at + i)));
  let at = -1;
  for (let index = 0; index + length <= next.childCount; index += 1) {
    if (matches(index) && (at < 0 || Math.abs(index - start) < Math.abs(at - start))) at = index;
  }
  // 서버도 같은 줄을 바꿨으면 가장 닮은 줄을 사용자 본문으로 덮는다.
  if (at < 0) at = Math.max(findPartner(sent.child(start), next, 0, next.childCount, start), 0);

  const blocks = (doc: Node, from: number, to: number) => Array.from({ length: Math.max(to - from, 0) }, (_, i) => doc.child(from + i));
  return nextDoc.copy(Fragment.fromArray([
    ...blocks(nextDoc, 0, at),
    ...blocks(currentDoc, start, currentEnd),
    ...blocks(nextDoc, at + length, nextDoc.childCount)
  ]));
}
