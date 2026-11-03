import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { DATA_HANDLING_GROUPS, DATA_HANDLING_TITLE } = await import("../src/views/landing/model/dataHandlingContent.ts");

const UI_DIR = new URL("../src/views/landing/ui/", import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), "utf8");
const allCopy = () => [DATA_HANDLING_TITLE, ...DATA_HANDLING_GROUPS.flatMap((group) => group.items)].join("\n");

test("문서 보호 섹션은 보관·접근·AI 처리·삭제 순서다", () => {
  assert.equal(DATA_HANDLING_TITLE, "내 문서는 이렇게 다뤄집니다");
  assert.deepEqual(
    DATA_HANDLING_GROUPS.map((group) => group.title),
    ["보관", "접근", "AI 처리", "삭제"]
  );
});

test("확인한 핵심 사실을 담는다", () => {
  const copy = allCopy();
  for (const fact of [
    "AWS 서울 리전",
    "TLS 1.2 이상",
    "워크스페이스 멤버만",
    "최대 1시간",
    "Fruition 서버 안의 모델",
    "Google·OpenAI·Anthropic",
    "음성 받아쓰기와 읽어 주기는 OpenAI",
    "자동 편입은 기본으로 꺼져",
    "30일"
  ]) {
    assert.ok(copy.includes(fact), fact);
  }
});

test("숫자 개인정보 가림은 범위를 함께 적는다(글자 기반 AI·숫자 형태만, 이미지·음성 제외)", () => {
  const ai = DATA_HANDLING_GROUPS.find((group) => group.id === "ai").items.join("\n");
  assert.match(ai, /글자 기반 AI 기능에 보낼 때는 주민등록번호·전화번호·카드번호·계좌번호 같은 숫자 형태 개인정보를 가린 뒤/);
  assert.match(ai, /PDF 이미지·음성은 가리지 않습니다/);
});

test("확인하지 않은 보장 문구를 쓰지 않는다", () => {
  const copy = allCopy();
  assert.doesNotMatch(copy, /외부로 전송되지 않|학습에 사용되지 않|보관하지 않|완벽|해킹|ISMS|ISO|SOC ?2|모든 개인정보/);
});

test("섹션은 제목에 연결된 section이고 묶음마다 h3과 목록을 쓴다", () => {
  const ui = read("LandingSections.tsx");
  assert.match(ui, /<section id="data-handling"[^>]*aria-labelledby="data-handling-title"/);
  assert.match(ui, /<h2 id="data-handling-title"/);
  assert.match(ui, /<h3 id=\{`data-handling-\$\{group\.id\}`\}/);
  assert.match(ui, /<ul className=\{sections\["data-handling-list"\]\}>/);
  assert.match(read("LandingPage.tsx"), /<LandingChapters \/>\s*<LandingDataHandling \/>\s*<LandingFaq \/>/);
});
