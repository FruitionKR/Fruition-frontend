// 튜토리얼 단계별 캡처 정의. id는 src/features/tutorial/model/tutorialContent.ts의 단계 id와 같다.
// run(h, locale)은 화면을 그 단계 상태로 만들고 { highlight, focus, group, minWidth, clip }을 돌려준다.
// cleanup(h)이 있으면 캡처 뒤에 불러 띄운 창을 데이터 변경 없이 닫는다.
// - highlight: 주 색 테두리를 덧그릴 요소(누를 버튼)
// - focus: 테두리 없이 잘라내기 영역에만 넣을 요소(보는 화면)
// - group: highlight 요소들을 테두리 하나로 묶는다.
// - minWidth: 잘라내기 최소 폭(CSS px, 기본 480). 넓을수록 축소돼 저장된다.
// 단계의 viewport는 그 단계를 열 창 크기다(기본 1440×900).
// 문구는 한국어로 쓰고 h.label·h.button·h.text가 화면 언어 문구로 바꿔 찾는다(labels.mjs).
// 데모 데이터 이름(README의 데모 데이터 목록)은 언어와 상관없이 같다.

/** 설정·로그·알림 화면은 줄이 본문 폭만큼 넓어 좁은 창으로 연다. */
const SETTINGS_VIEWPORT = { width: 1100, height: 800 };

const DOC = { note: "새 노트", pdf: "Market Report", roadmap: "Product Roadmap", handbook: "Team Handbook", folder: "Projects", trashed: "Old Draft" };

/** 답변·근거 화면용 질문. title은 세션 목록에서 그 채팅을 찾는 정규식이다(서버가 질문으로 제목을 붙인다). */
const ANSWER_QUESTIONS = {
  ko: { text: "1분기 목표와 담당 팀을 알려 줘", title: /1분기/ },
  en: { text: "What are the Q1 goals and which teams own them?", title: /Q1 Goals/i }
};

/** 사이드바 트리 행 */
const treeRow = (page, name) => page.locator("button:visible", { hasText: name }).filter({ has: page.getByText(name, { exact: true }) }).first();

async function openNewNoteMenu(h) {
  await h.home();
  await h.text("새 노트 추가").click();
  await h.page.waitForTimeout(500);
  return h.page.getByRole("menu").last();
}

async function openTreeContextMenu(h, name) {
  await h.home();
  // 행 오른쪽의 변환 표시 링크가 가운데 클릭을 가로챌 수 있어 이름 쪽을 누른다.
  await treeRow(h.page, name).click({ button: "right", position: { x: 48, y: 12 } });
  await h.page.waitForTimeout(500);
  return h.page.getByRole("menu").last();
}

export const STEPS = [
  {
    id: "choose-workspace",
    async run(h) {
      await h.home();
      const switcher = h.page.getByRole("button", { name: new RegExp(`^${escapeRegExp(h.label("워크스페이스 전환 ({name})", { name: "" }).replace(/\s*\(\)$/, ""))}`) });
      await switcher.click();
      await h.page.waitForTimeout(500);
      return { highlight: [switcher], focus: [h.text("새 워크스페이스")] };
    }
  },
  {
    id: "screen-layout",
    async run(h, locale) {
      await h.home(DOC.roadmap);
      await openLocaleChat(h, locale);
      return { clip: { x: 0, y: 0, width: 1440, height: 810 } };
    }
  },
  {
    id: "chat-panel-tabs",
    async run(h) {
      await h.home(DOC.roadmap);
      const tabs = h.page.getByText(h.label("채팅"), { exact: true }).first().locator("xpath=..");
      return { highlight: [tabs] };
    }
  },
  {
    id: "write-note",
    async run(h) {
      const menu = await openNewNoteMenu(h);
      return { highlight: [menu.getByText(h.label("새 노트"), { exact: true })], focus: [menu, h.text("새 노트 추가")] };
    }
  },
  {
    id: "upload-files",
    async run(h) {
      const menu = await openNewNoteMenu(h);
      return { highlight: [menu.getByText(h.label("파일 업로드"), { exact: true })], focus: [menu, h.text("새 노트 추가")] };
    }
  },
  {
    id: "organize-folders",
    async run(h) {
      const menu = await openNewNoteMenu(h);
      return { highlight: [menu.getByText(h.label("새 폴더"), { exact: true })], focus: [menu, treeRow(h.page, DOC.folder)] };
    }
  },
  {
    id: "edit-permissions",
    async run(h) {
      const menu = await openTreeContextMenu(h, DOC.roadmap);
      return { highlight: [menu.getByText(h.label("권한 설정"), { exact: true })], focus: [menu, treeRow(h.page, DOC.roadmap)] };
    }
  },
  {
    id: "delete-restore",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("휴지통");
      const row = h.page.getByText(`${DOC.trashed}.md`, { exact: true }).first();
      const restore = h.button("복구").first();
      return { highlight: [restore], focus: [row] };
    }
  },
  {
    id: "convert-pdf",
    async run(h) {
      const menu = await openTreeContextMenu(h, DOC.pdf);
      return { highlight: [menu.getByText(h.label("Markdown으로 변환"), { exact: true })], focus: [menu, treeRow(h.page, DOC.pdf)] };
    }
  },
  {
    id: "converted-under-source",
    async run(h) {
      await h.home();
      const rows = h.page.locator("button", { has: h.page.getByText(DOC.pdf, { exact: true }) });
      return { highlight: [rows.nth(0), rows.nth(1)], group: true };
    }
  },
  {
    id: "describe-figures",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("워크스페이스 설정");
      return { highlight: [await settingRow(h, "PDF 속 그림을 AI가 글로 설명하기")] };
    }
  },
  {
    id: "markdown-auto-ingest",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("워크스페이스 설정");
      return { highlight: [await settingRow(h, "Markdown 업로드 시 자동으로 위키에 편입")] };
    }
  },
  {
    id: "converted-ingest-prompt",
    async run(h) {
      await h.home();
      // 변환본을 열면 편입 확인 창이 뜬다. 닫은 기록은 sessionStorage라 새 브라우저에서는 다시 뜬다.
      const rows = h.page.locator("button", { has: h.page.getByText(DOC.pdf, { exact: true }) });
      await rows.nth(1).click();
      const dialog = h.page.getByRole("alertdialog").filter({ hasText: h.label("이 문서를 위키에 편입할까요?") });
      await dialog.waitFor();
      await h.page.waitForTimeout(500);
      return { highlight: [dialog.getByRole("button", { name: h.label("확인"), exact: true })], focus: [dialog] };
    },
    // 확인 창은 취소로 닫아 편입하지 않는다(LLM 비용).
    async cleanup(h) {
      await h.page.getByRole("alertdialog").getByRole("button", { name: h.label("취소"), exact: true }).click().catch(() => {});
    }
  },
  {
    id: "choose-ingest",
    // 레일 버튼과 사이드바 아래 '위키 편입 (n)'이 한 장에 들어가게 창 높이를 줄인다.
    viewport: { width: 1440, height: 640 },
    async run(h) {
      await h.home();
      await h.rail("그래프");
      const ingest = h.page.getByRole("button", { name: new RegExp(`^${escapeRegExp(h.label("위키 편입"))}`) }).first();
      await ingest.click();
      await h.page.waitForTimeout(800);
      // 편입하지 않은 문서 하나를 골라 개수가 보이게 한다. 실제 편입 버튼은 누르지 않는다.
      await h.page.getByRole("checkbox").first().check().catch(() => {});
      await h.page.waitForTimeout(300);
      const submit = h.page.getByRole("button", { name: new RegExp(`^${escapeRegExp(h.label("위키 편입"))} \\(`) }).last();
      return { highlight: [ingest, submit] };
    }
  },
  {
    id: "refresh-wiki",
    async run(h) {
      await h.home();
      await h.rail("그래프");
      const refresh = h.page.getByRole("button", { name: new RegExp(`^${escapeRegExp(h.label("위키 최신화"))}`) }).first();
      return { highlight: [refresh] };
    }
  },
  {
    id: "graph-nodes",
    async run(h) {
      await h.home();
      await h.rail("그래프");
      await h.page.waitForTimeout(2500);
      const filters = h.page.locator("button[aria-pressed]:visible").filter({ hasText: /raw|source|concept/i });
      return { highlight: [filters.first(), filters.last()], group: true, minWidth: 720 };
    }
  },
  {
    id: "graph-explore",
    async run(h) {
      await h.home();
      await h.rail("그래프");
      await h.page.waitForTimeout(2500);
      return { highlight: [h.button("그래프 새로고침")], clip: { x: 400, y: 0, width: 1040, height: 585 } };
    }
  },
  {
    id: "ask-question",
    async run(h, locale) {
      await h.home(DOC.roadmap);
      await openLocaleChat(h, locale);
      const input = h.page.getByPlaceholder(h.label("AI 에이전트에게 무엇이든 물어보세요.")).first();
      await input.fill(locale === "ko" ? "1분기 목표는 뭐야?" : "What are the Q1 goals?");
      return { highlight: [input.locator("xpath=ancestor::*[.//button[@aria-label]][1]")] };
    },
    // 입력창에 쓴 글은 초안으로 남아 다음 단계 화면에 보이므로 지운다.
    async cleanup(h) {
      await clearComposer(h);
    }
  },
  {
    id: "answer-sources",
    // 그 언어로 물은 채팅이 있으면 그 세션을 열어 찍는다. 없으면 TUTORIAL_ASK=1일 때만 실제로 질문한다(LLM 비용).
    async run(h, locale) {
      const question = ANSWER_QUESTIONS[locale];
      await h.home(DOC.roadmap);
      if (!(await openLocaleChat(h, locale))) {
        if (process.env.TUTORIAL_ASK !== "1") throw new Error("답변이 있는 채팅이 없습니다. TUTORIAL_ASK=1로 다시 실행하면 질문을 보냅니다.");
        await h.page.keyboard.press("Escape");
        await h.button("채팅 옵션").click();
        await h.text("새 채팅").last().click();
        await h.page.waitForTimeout(800);
        const input = h.page.getByPlaceholder(h.label("AI 에이전트에게 무엇이든 물어보세요.")).first();
        await input.fill(question.text);
        await input.press("Enter");
      }
      // agentChat.sources.found는 영어가 ICU 복수형이라 labels.mjs로 바꾸지 않고 언어별 정규식으로 찾는다.
      const found = h.page.getByText(locale === "ko" ? /^찾은 자료 \d+건/ : /^\d+ sources? found/).last();
      const listen = h.page.getByText(h.label("듣기"), { exact: true }).last();
      await listen.waitFor({ timeout: 180_000 });
      await h.page.waitForTimeout(1000);
      return { highlight: [found], focus: [listen] };
    }
  },
  {
    id: "note-evidence-notice",
    async run(h) {
      await h.home(DOC.note);
      const button = h.button("위키에 편입").last();
      return { highlight: [button], focus: [button.locator("xpath=..")] };
    }
  },
  {
    id: "save-chat",
    async run(h) {
      await h.home(DOC.roadmap);
      await h.button("채팅 옵션").click();
      await h.page.waitForTimeout(500);
      return { highlight: [h.text("채팅을 문서로 편입")], focus: [h.button("채팅 옵션")] };
    }
  },
  {
    id: "request-task",
    async run(h, locale) {
      await h.home(DOC.roadmap);
      await h.page.getByText(h.label("작업"), { exact: true }).first().click();
      await h.page.waitForTimeout(800);
      const input = h.page.locator("textarea:visible, [contenteditable=true]:visible").last();
      await input.click();
      await h.page.keyboard.type(locale === "ko" ? "이 문서에 2분기 목표 섹션을 추가해 줘" : "Add a Q2 goals section to this document");
      return { highlight: [input.locator("xpath=ancestor::*[.//button[@aria-label]][1]")] };
    },
    // 입력창에 쓴 글은 초안으로 남아 다음 단계 화면에 보이므로 지운다.
    async cleanup(h) {
      await clearComposer(h);
      // 다음 단계가 채팅 탭에서 시작하게 되돌린다.
      await h.page.getByText(h.label("채팅"), { exact: true }).first().click();
    }
  },
  {
    id: "auto-approval",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("AI 설정");
      const first = await settingRow(h, "폴더 생성·이동·이름 변경");
      const second = await settingRow(h, "문서 편집·생성");
      return { highlight: [first, second], group: true, focus: [h.text("AI 에이전트 자동 승인").first()] };
    }
  },
  {
    id: "browse-skills",
    async run(h) {
      await h.home();
      await h.rail("스킬");
      const tabs = h.page.getByRole("tab");
      return { highlight: [tabs.first(), tabs.last()], group: true, minWidth: 720 };
    }
  },
  {
    id: "create-skill",
    async run(h) {
      await h.home();
      await h.rail("스킬");
      await h.button("스킬 만들기", {}, "skills.view").click();
      await h.page.waitForTimeout(1200);
      // 버튼이 시트 아래쪽에 있어 보이게 스크롤한 뒤 잰다.
      const write = h.page.getByRole("button", { name: new RegExp(escapeRegExp(h.label("AI로 작성·보강"))) }).first();
      await write.scrollIntoViewIfNeeded();
      await h.page.waitForTimeout(400);
      return { highlight: [write], minWidth: 720 };
    }
  },
  {
    id: "record-meeting",
    async run(h, locale) {
      await openVoiceMenu(h, locale);
      return { highlight: [h.text("회의 녹음하기")], focus: [h.text("말로 입력하기"), h.text("지난 회의 보기")] };
    }
  },
  {
    id: "upload-recording",
    async run(h, locale) {
      await openVoiceMenu(h, locale);
      return { highlight: [h.text("녹음 파일 올리기")], focus: [h.text("말로 입력하기"), h.text("지난 회의 보기")] };
    }
  },
  {
    id: "past-meetings",
    async run(h, locale) {
      await openVoiceMenu(h, locale);
      return { highlight: [h.text("지난 회의 보기")], focus: [h.text("말로 입력하기"), h.button("음성 기능")] };
    }
  },
  {
    id: "preview-import",
    async run(h) {
      const menu = await openNewNoteMenu(h);
      return { highlight: [menu.getByText(h.label("Notion에서 가져오기"), { exact: true })], focus: [menu, h.text("새 노트 추가")] };
    }
  },
  {
    id: "view-logs",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.rail("로그");
      const tabs = h.page.getByRole("tab");
      return { highlight: [tabs.first(), tabs.last()], group: true, minWidth: 720 };
    }
  },
  {
    id: "rollback-operation",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.rail("로그");
      // 첫 번째는 사이드바 트리, 두 번째가 로그 목록의 작업이다.
      const operation = h.page.getByText(DOC.roadmap, { exact: true }).nth(1);
      await operation.click();
      await h.page.waitForTimeout(1200);
      return { highlight: [h.page.getByRole("button", { name: h.label("Rollback") }).first()], focus: [operation] };
    }
  },
  {
    id: "check-notifications",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.rail("알림");
      const tabs = h.page.getByRole("tab");
      return { highlight: [tabs.first(), tabs.last(), h.button("전체 읽음 처리")] };
    }
  },
  {
    id: "change-language",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("디스플레이 설정");
      const korean = h.page.getByText("한국어", { exact: true }).first();
      const english = h.page.getByText("English", { exact: true }).first();
      return { highlight: [korean.locator("xpath=ancestor::button[1]"), english.locator("xpath=ancestor::button[1]")], group: true };
    }
  },
  {
    id: "auto-ingest-switches",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("워크스페이스 설정");
      const first = await settingRow(h, "Markdown 업로드 시 자동으로 위키에 편입");
      const second = await settingRow(h, "PDF 변환본도 변환 직후 자동으로 위키에 편입");
      return { highlight: [first, second], group: true };
    }
  },
  {
    id: "manage-members",
    viewport: SETTINGS_VIEWPORT,
    async run(h) {
      await h.home();
      await h.settings("멤버 관리");
      return { highlight: [h.button("멤버 초대하기").first()], minWidth: 720 };
    }
  }
];

/** 설정 화면에서 문구가 든 한 줄(라벨과 스위치)을 찾아 보이게 스크롤한다. */
async function settingRow(h, koText) {
  const text = h.page.getByText(h.label(koText), { exact: true }).first();
  await text.scrollIntoViewIfNeeded();
  await h.page.waitForTimeout(300);
  return text.locator("xpath=ancestor::*[.//input or .//button[@role='switch']][1]");
}

/** 그 언어로 물은 채팅 세션을 연다. 없으면 false. 화면 언어와 다른 언어의 답변이 배경에 보이지 않게 한다. */
async function openLocaleChat(h, locale) {
  await h.page.locator("button[aria-haspopup][class*='agent-session-title']").click();
  await h.page.waitForTimeout(600);
  const session = h.page.locator("button[class*='chat-session-select']", { hasText: ANSWER_QUESTIONS[locale].title }).first();
  if (!(await session.count())) return false;
  await session.click();
  await h.page.waitForTimeout(1500);
  return true;
}

async function clearComposer(h) {
  const input = h.page.locator("textarea:visible, [contenteditable=true]:visible").last();
  await input.click();
  await h.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await h.page.keyboard.press("Backspace");
  await h.page.waitForTimeout(300);
}

async function openVoiceMenu(h, locale) {
  await h.home(DOC.roadmap);
  await openLocaleChat(h, locale);
  await h.button("음성 기능").click();
  await h.page.waitForTimeout(500);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
