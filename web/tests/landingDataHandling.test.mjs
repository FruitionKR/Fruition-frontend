import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { DATA_HANDLING_GROUPS } = await import("../src/views/landing/model/dataHandlingContent.ts");

// 문구는 언어별 메시지에 있다. 사실 범위 검사는 한국어 원문으로 하고, 영어도 같은 금지 표현을 확인한다.
const messages = (locale) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/landing.json`, import.meta.url), "utf8")).dataHandling;
const ko = messages("ko");
const en = messages("en");
const itemsOf = (locale, group) => group.items.map((item) => locale.items[item]);

const UI_DIR = new URL("../src/views/landing/ui/", import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), "utf8");
const allCopy = (locale = ko) => DATA_HANDLING_GROUPS.flatMap((group) => [locale.groups[group.id].headline, ...itemsOf(locale, group)]).join("\n");

test("문서 보호 섹션은 보관·접근·AI 처리·삭제 순서다", () => {
  assert.deepEqual(
    DATA_HANDLING_GROUPS.map((group) => ko.groups[group.id].title),
    ["보관", "접근", "AI 처리", "삭제"]
  );
  assert.deepEqual(
    DATA_HANDLING_GROUPS.map((group) => [group.english, ko.groups[group.id].headline]),
    [
      ["STORAGE", "잠긴 채로 보관합니다"],
      ["ACCESS", "허락한 사람만 볼 수 있습니다"],
      ["AI PROCESSING", "AI에는 필요한 만큼만"],
      ["DELETION", "지울 때도 안전하게"]
    ]
  );
});

test("확인한 핵심 사실을 담는다", () => {
  const copy = allCopy();
  for (const fact of [
    "AWS 서울 리전",
    "TLS 1.2 이상",
    "워크스페이스 멤버가 아니면 문서를 볼 수 없고",
    "최대 1시간",
    "Fruition 서버 안의 모델",
    "자동 편입은 기본으로 꺼져",
    "30일"
  ]) {
    assert.ok(copy.includes(fact), fact);
  }
});

test("숫자 개인정보 가림은 글자 요청·숫자 형태로 범위를 적는다", () => {
  const ai = itemsOf(ko, DATA_HANDLING_GROUPS.find((group) => group.id === "ai")).join("\n");
  assert.match(ai, /글자로 보내는 AI 요청에서는 주민등록번호·전화번호·카드번호·계좌번호 같은 숫자 형태 개인정보를 자동으로 가린 뒤 보냅니다/);
  // "외부로 보내지 않습니다"는 임베딩 문장에만 쓴다.
  const external = DATA_HANDLING_GROUPS.flatMap((group) => itemsOf(ko, group)).filter((item) => item.includes("외부로 보내지 않"));
  assert.deepEqual(external.length, 1);
  assert.match(external[0], /^검색을 위한 문서 분석\(임베딩\)/);
});

test("문서를 지키는 방식만 적고 제공사·음성 전송 고지는 넣지 않는다(처리방침·AI 사전 고지에서 다룸)", () => {
  assert.doesNotMatch(allCopy(), /Google|OpenAI|Anthropic|가리지 않습니다/);
  assert.doesNotMatch(allCopy(en), /Google|OpenAI|Anthropic|not masked/i);
});

test("확인하지 않은 보장 문구를 쓰지 않는다", () => {
  const copy = allCopy();
  assert.doesNotMatch(copy, /외부로 전송되지 않|학습에 사용되지 않|보관하지 않|완벽|해킹|ISMS|ISO|SOC ?2|모든 개인정보/);
  assert.doesNotMatch(allCopy(en), /used for training|perfect|hack|ISMS|ISO|SOC ?2|all personal/i);
});

test("섹션은 제목에 연결된 section이고 묶음마다 h3과 목록을 쓴다", () => {
  const ui = read("LandingSections.tsx");
  assert.match(ui, /<section id="data-handling"[^>]*aria-labelledby="data-handling-title"/);
  assert.match(ui, /<h2 id="data-handling-title"[^>]*>\s*\{t\("nav\.dataHandling"\)\}\s*<\/h2>/);
  // 제목은 메뉴 이름 하나만 쓰고 부제는 두지 않는다.
  const section = ui.split("export function LandingDataHandling")[1].split("export function")[0];
  assert.doesNotMatch(section, /styles\["lead"\]/);
  assert.match(ui, /<h3 id=\{`data-handling-\$\{group\.id\}`\}[^>]*>\s*\{t\(`dataHandling\.groups\.\$\{group\.id\}\.headline`\)\}/);
  assert.match(ui, /<ul className=\{sections\["data-handling-list"\]\}>/);
  assert.match(read("LandingPage.tsx"), /<LandingTogether \/>\s*<LandingDataHandling \/>\s*<LandingFaq \/>/);
});
