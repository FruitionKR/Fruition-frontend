/**
 * 스킬 화면 시트 상태. 스킬 만들기(Figma 1671:13573)·스킬 상세(1708:3848) 시트를 하나만 연다.
 * key는 다른 시트로 바뀔 때 입력 컴포넌트를 새로 시작하게 하는 React key다.
 */

export type SkillSheetState =
  | { kind: "create"; key: number; prefillRequest?: string }
  | { kind: "detail"; key: number; skillId: string }
  | null;

function nextKey(current: SkillSheetState): number {
  return current == null ? 1 : current.key + 1;
}

/**
 * 스킬 만들기 시트를 연다. request는 작업 탭 "이 요청을 스킬로 저장"(Figma 1671:13245)의 요청 문장이다.
 * 같은 요청(또는 요청 없이)으로 만들기 시트가 이미 열려 있으면 그대로 두어 입력을 지킨다.
 */
export function openCreateSheet(current: SkillSheetState, request?: string): SkillSheetState {
  const prefillRequest = request?.trim() || undefined;
  if (current?.kind === "create" && current.prefillRequest === prefillRequest) return current;
  return prefillRequest
    ? { kind: "create", key: nextKey(current), prefillRequest }
    : { kind: "create", key: nextKey(current) };
}

/** 스킬 상세 시트를 연다. 같은 스킬 시트가 이미 열려 있으면 그대로 둔다(입력 유지). */
export function openDetailSheet(current: SkillSheetState, skillId: string): SkillSheetState {
  if (current?.kind === "detail" && current.skillId === skillId) return current;
  return { kind: "detail", key: nextKey(current), skillId };
}

/** 목록에서 사라진 스킬(삭제 등)의 상세 시트를 닫는다. 바뀐 게 없으면 같은 상태를 돌려준다. */
export function closeSheetIfSkillGone(current: SkillSheetState, skillIds: readonly string[]): SkillSheetState {
  if (current?.kind !== "detail") return current;
  return skillIds.includes(current.skillId) ? current : null;
}
