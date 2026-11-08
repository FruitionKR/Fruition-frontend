// 튜토리얼 단계 이동·진행 표시·마지막 위치 저장. 순수 함수만 두어 node:test로 검증한다(tests/tutorialNavigation.test.mjs).
// 섹션 목록은 구조만 보므로 tutorialContent.ts의 TUTORIAL_SECTIONS를 그대로 넘긴다.

/** 섹션 안 몇 번째 단계를 보고 있는지. 둘 다 0부터 센다. */
export type TutorialPosition = { sectionIndex: number; stepIndex: number };

export type TutorialSectionShape = { id: string; steps: readonly { id: string }[] };
type Sections = readonly TutorialSectionShape[];

export const TUTORIAL_START: TutorialPosition = { sectionIndex: 0, stepIndex: 0 };

/** 모든 섹션의 단계 수 합 */
export function totalSteps(sections: Sections): number {
  return sections.reduce((sum, section) => sum + section.steps.length, 0);
}

/** 전체 단계 중 몇 번째인지(0부터). 범위를 벗어난 위치는 가장 가까운 단계로 맞춘다. */
export function flatIndex(sections: Sections, position: TutorialPosition): number {
  const total = totalSteps(sections);
  if (total === 0) return 0;
  const sectionIndex = Math.min(Math.max(position.sectionIndex, 0), sections.length - 1);
  const before = sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.steps.length, 0);
  const stepCount = sections[sectionIndex].steps.length;
  const stepIndex = Math.min(Math.max(position.stepIndex, 0), Math.max(stepCount - 1, 0));
  return Math.min(before + stepIndex, total - 1);
}

/** 전체 순번(0부터)을 섹션·단계 위치로 바꾼다. 단계가 없는 섹션은 건너뛴다. */
export function positionAt(sections: Sections, index: number): TutorialPosition {
  const total = totalSteps(sections);
  if (total === 0) return TUTORIAL_START;
  let remaining = Math.min(Math.max(index, 0), total - 1);
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const count = sections[sectionIndex].steps.length;
    if (remaining < count) return { sectionIndex, stepIndex: remaining };
    remaining -= count;
  }
  return TUTORIAL_START;
}

/** 잘못된 위치(줄어든 내용 등)를 실제로 있는 단계로 맞춘다. */
export function clampPosition(sections: Sections, position: TutorialPosition): TutorialPosition {
  return positionAt(sections, flatIndex(sections, position));
}

/** 다음 단계. 섹션 끝이면 다음 섹션 첫 단계로 넘어가고, 마지막 단계에서는 그대로다. */
export function nextPosition(sections: Sections, position: TutorialPosition): TutorialPosition {
  return positionAt(sections, flatIndex(sections, position) + 1);
}

/** 이전 단계. 섹션 처음이면 앞 섹션의 마지막 단계로 돌아가고, 첫 단계에서는 그대로다. */
export function prevPosition(sections: Sections, position: TutorialPosition): TutorialPosition {
  return positionAt(sections, flatIndex(sections, position) - 1);
}

/** 섹션을 고르면 그 섹션의 첫 단계로 간다. 단계가 없는 섹션이면 그 뒤 첫 단계로 간다. */
export function sectionStart(sections: Sections, sectionIndex: number): TutorialPosition {
  const before = sections.slice(0, Math.max(sectionIndex, 0)).reduce((sum, section) => sum + section.steps.length, 0);
  return positionAt(sections, before);
}

export function isFirstStep(sections: Sections, position: TutorialPosition): boolean {
  return flatIndex(sections, position) === 0;
}

/** 마지막 단계면 "다음" 대신 "완료"를 보인다. */
export function isLastStep(sections: Sections, position: TutorialPosition): boolean {
  return flatIndex(sections, position) >= totalSteps(sections) - 1;
}

/** 진행 표시 `{current} / {total}`. current는 1부터 센다. */
export function tutorialProgress(sections: Sections, position: TutorialPosition): { current: number; total: number } {
  const total = totalSteps(sections);
  return { current: total === 0 ? 0 : flatIndex(sections, position) + 1, total };
}

// --- 마지막으로 본 위치 저장 ---

export const TUTORIAL_STORAGE_KEY = "fruition.tutorial.v1";

/** localStorage와 같은 최소 인터페이스. 테스트에서는 Map 기반 가짜를 넘긴다. */
export type TutorialStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * 저장해 둔 위치를 읽는다. 내용이 바뀌어도 맞게 순번이 아닌 섹션·단계 id로 저장한다.
 * 저장소를 못 읽거나(사생활 모드 등) 값이 깨졌거나 그 단계가 없어졌으면 처음부터 보인다.
 * 섹션은 남았는데 단계만 없어졌으면 그 섹션 처음으로 간다.
 */
export function readTutorialPosition(storage: TutorialStorage | null | undefined, sections: Sections): TutorialPosition {
  try {
    const raw = storage?.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return TUTORIAL_START;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return TUTORIAL_START;
    const { sectionId, stepId } = saved as { sectionId?: unknown; stepId?: unknown };
    const sectionIndex = sections.findIndex((section) => section.id === sectionId);
    if (sectionIndex < 0) return TUTORIAL_START;
    const stepIndex = sections[sectionIndex].steps.findIndex((step) => step.id === stepId);
    return stepIndex < 0 ? sectionStart(sections, sectionIndex) : { sectionIndex, stepIndex };
  } catch {
    return TUTORIAL_START;
  }
}

/** 지금 위치를 저장한다. 실패해도(용량 초과·사생활 모드) 화면은 그대로 두고 성공 여부만 돌려준다. */
export function writeTutorialPosition(storage: TutorialStorage | null | undefined, sections: Sections, position: TutorialPosition): boolean {
  const { sectionIndex, stepIndex } = clampPosition(sections, position);
  const section = sections[sectionIndex];
  const step = section?.steps[stepIndex];
  if (!storage || !section || !step) return false;
  try {
    storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ sectionId: section.id, stepId: step.id }));
    return true;
  } catch {
    return false;
  }
}

/** 완료하면 저장을 지워 다음에는 처음부터 보인다. */
export function clearTutorialPosition(storage: TutorialStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(TUTORIAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
