import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TUTORIAL_START,
  TUTORIAL_STORAGE_KEY,
  clampPosition,
  clearTutorialPosition,
  isFirstStep,
  isLastStep,
  nextPosition,
  prevPosition,
  readTutorialPosition,
  sectionStart,
  totalSteps,
  tutorialProgress,
  writeTutorialPosition
} from "../src/features/tutorial/model/tutorialNavigation.ts";

// 내용 파일(tutorialContent.ts)과 같은 모양의 테스트 전용 데이터. 실제 내용과 상관없이 이동 규칙만 본다.
const SECTIONS = [
  { id: "start", icon: "start", steps: [{ id: "welcome" }, { id: "layout" }] },
  { id: "empty", icon: "document", steps: [] },
  { id: "documents", icon: "document", steps: [{ id: "upload" }, { id: "pdf" }, { id: "import" }] },
  { id: "wiki", icon: "wiki", steps: [{ id: "ingest" }] }
];

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    map
  };
}

const throwingStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); }
};

test("다음은 섹션 끝에서 다음 섹션 첫 단계로 넘어가고, 단계가 없는 섹션은 건너뛴다", () => {
  assert.deepEqual(nextPosition(SECTIONS, { sectionIndex: 0, stepIndex: 0 }), { sectionIndex: 0, stepIndex: 1 });
  assert.deepEqual(nextPosition(SECTIONS, { sectionIndex: 0, stepIndex: 1 }), { sectionIndex: 2, stepIndex: 0 });
  assert.deepEqual(nextPosition(SECTIONS, { sectionIndex: 2, stepIndex: 2 }), { sectionIndex: 3, stepIndex: 0 });
});

test("이전은 섹션 처음에서 앞 섹션 마지막 단계로 돌아가고, 처음·끝에서는 더 움직이지 않는다", () => {
  assert.deepEqual(prevPosition(SECTIONS, { sectionIndex: 2, stepIndex: 0 }), { sectionIndex: 0, stepIndex: 1 });
  assert.deepEqual(prevPosition(SECTIONS, TUTORIAL_START), TUTORIAL_START);
  const last = { sectionIndex: 3, stepIndex: 0 };
  assert.deepEqual(nextPosition(SECTIONS, last), last);
});

test("섹션을 고르면 그 섹션 첫 단계로 가고, 빈 섹션이면 그 뒤 첫 단계로 간다", () => {
  assert.deepEqual(sectionStart(SECTIONS, 2), { sectionIndex: 2, stepIndex: 0 });
  assert.deepEqual(sectionStart(SECTIONS, 1), { sectionIndex: 2, stepIndex: 0 });
  assert.deepEqual(sectionStart(SECTIONS, 3), { sectionIndex: 3, stepIndex: 0 });
});

test("진행 표시는 전체 단계 기준 1부터 세고, 마지막 단계에서만 완료로 본다", () => {
  assert.equal(totalSteps(SECTIONS), 6);
  assert.deepEqual(tutorialProgress(SECTIONS, TUTORIAL_START), { current: 1, total: 6 });
  assert.deepEqual(tutorialProgress(SECTIONS, { sectionIndex: 2, stepIndex: 1 }), { current: 4, total: 6 });
  assert.equal(isFirstStep(SECTIONS, TUTORIAL_START), true);
  assert.equal(isLastStep(SECTIONS, TUTORIAL_START), false);
  assert.equal(isLastStep(SECTIONS, { sectionIndex: 3, stepIndex: 0 }), true);
  assert.deepEqual(tutorialProgress(SECTIONS, { sectionIndex: 3, stepIndex: 0 }), { current: 6, total: 6 });
});

test("범위를 벗어난 위치는 실제로 있는 단계로 맞춘다", () => {
  assert.deepEqual(clampPosition(SECTIONS, { sectionIndex: 9, stepIndex: 9 }), { sectionIndex: 3, stepIndex: 0 });
  assert.deepEqual(clampPosition(SECTIONS, { sectionIndex: 0, stepIndex: 7 }), { sectionIndex: 0, stepIndex: 1 });
  assert.deepEqual(clampPosition(SECTIONS, { sectionIndex: -1, stepIndex: -1 }), TUTORIAL_START);
});

test("마지막으로 본 위치를 섹션·단계 id로 저장하고 다시 열면 그 자리에서 이어진다", () => {
  const storage = fakeStorage();
  assert.deepEqual(readTutorialPosition(storage, SECTIONS), TUTORIAL_START);
  assert.equal(writeTutorialPosition(storage, SECTIONS, { sectionIndex: 2, stepIndex: 1 }), true);
  assert.deepEqual(JSON.parse(storage.map.get(TUTORIAL_STORAGE_KEY)), { sectionId: "documents", stepId: "pdf" });
  assert.deepEqual(readTutorialPosition(storage, SECTIONS), { sectionIndex: 2, stepIndex: 1 });
});

test("내용 순서가 바뀌어도 id로 같은 단계를 찾고, 단계만 없어지면 그 섹션 처음으로 간다", () => {
  const storage = fakeStorage();
  writeTutorialPosition(storage, SECTIONS, { sectionIndex: 2, stepIndex: 2 });
  const reordered = [SECTIONS[2], SECTIONS[0]];
  assert.deepEqual(readTutorialPosition(storage, reordered), { sectionIndex: 0, stepIndex: 2 });
  const shrunk = [SECTIONS[0], { id: "documents", icon: "document", steps: [{ id: "upload" }] }];
  assert.deepEqual(readTutorialPosition(storage, shrunk), { sectionIndex: 1, stepIndex: 0 });
  assert.deepEqual(readTutorialPosition(storage, [SECTIONS[0]]), TUTORIAL_START);
});

test("값이 깨졌거나 저장소가 없거나 던지면 예외 없이 처음부터 보이고 저장 실패만 알린다", () => {
  const storage = fakeStorage();
  for (const raw of ["{", "null", "42", JSON.stringify({ sectionId: 3 })]) {
    storage.setItem(TUTORIAL_STORAGE_KEY, raw);
    assert.deepEqual(readTutorialPosition(storage, SECTIONS), TUTORIAL_START, raw);
  }
  assert.deepEqual(readTutorialPosition(null, SECTIONS), TUTORIAL_START);
  assert.deepEqual(readTutorialPosition(throwingStorage, SECTIONS), TUTORIAL_START);
  assert.equal(writeTutorialPosition(null, SECTIONS, TUTORIAL_START), false);
  assert.equal(writeTutorialPosition(throwingStorage, SECTIONS, TUTORIAL_START), false);
  assert.equal(clearTutorialPosition(throwingStorage), false);
});

test("완료하면 저장을 지워 다음에는 처음부터 보인다", () => {
  const storage = fakeStorage();
  writeTutorialPosition(storage, SECTIONS, { sectionIndex: 3, stepIndex: 0 });
  assert.equal(clearTutorialPosition(storage), true);
  assert.deepEqual(readTutorialPosition(storage, SECTIONS), TUTORIAL_START);
});

test("레일 하단에서 사용 방법 ? 버튼이 설정 톱니 바로 위에 있고 모달을 연다", async () => {
  const source = await readFile(new URL("../src/widgets/document-sidebar/ui/SidebarProfile.tsx", import.meta.url), "utf8");
  const help = source.indexOf("<RailHelpIcon />");
  const setting = source.indexOf("<RailSettingIcon />");
  assert.ok(help > 0 && setting > help, "? 버튼이 설정 버튼보다 앞(위)에 그려진다");
  // 둘 사이에는 모달 말고 다른 레일 버튼이 없다.
  assert.equal(source.slice(help, setting).match(/<RailButton/g)?.length, 1);
  assert.match(source, /label=\{tTutorial\("open"\)\}[\s\S]{0,120}?phoneLabel=\{tTutorial\("openShort"\)\}/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /tutorial\.isOpen && <TutorialDialog onClose=\{tutorial\.close\} \/>/);
});

test("튜토리얼 모달은 제목으로 이름을 붙이고 단계 본문 줄바꿈을 살린다", async () => {
  const [dialog, css] = await Promise.all([
    readFile(new URL("../src/features/tutorial/ui/TutorialDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tutorial/ui/TutorialDialog.module.css", import.meta.url), "utf8")
  ]);
  assert.match(dialog, /<CenteredModal[^>]*labelledBy=\{titleId\}/);
  assert.match(dialog, /<h2 id=\{titleId\}/);
  assert.match(dialog, /event\.key === "ArrowRight"/);
  assert.match(dialog, /event\.key === "ArrowLeft"/);
  assert.match(css, /\.step-body \{[^}]*white-space: pre-line;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
