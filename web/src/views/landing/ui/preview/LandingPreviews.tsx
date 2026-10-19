import type { LandingChapterId } from "../../model/landingContent";
import { AnswerDemo } from "../AnswerDemo";
import { ChatPanel, DictationPanel, EditorPane, TaskPanel } from "./PreviewPanes";
import { GraphPane, MembersPane, SkillsPane } from "./PreviewPages";
import { PreviewFrame } from "./PreviewFrame";
import { PreviewShell } from "./PreviewShell";

/*
 * 섹션별 앱 화면 미리보기 조합. Figma 노드 → 미리보기:
 * - 히어로: 1406:13013(graph_chat) 위키 그래프 + 1540:19718(chat) 근거 답변
 * - 기록(#capture): 1571:27625 셸 + 편집기 + 1540:22903(회의록 받아쓰기)
 * - 지식화(#connect): 1406:13761(graph)
 * - 활용(#discover): 1540:19718(chat) · 1571:27625(작업 탭과 본문 제안) · 1482:9848(skill)
 * - 협업(#together): 1540:21567(member)
 */

const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const DEMO_WIDTH = 1280;
const DEMO_HEIGHT = 800;

export function HeroPreview() {
  return (
    <PreviewFrame width={APP_WIDTH} height={APP_HEIGHT}>
      <PreviewShell sidebar="graph">
        <GraphPane />
        <ChatPanel />
      </PreviewShell>
    </PreviewFrame>
  );
}

export function ChapterPreview({ id }: { id: Exclude<LandingChapterId, "discover"> }) {
  switch (id) {
    case "capture":
      return (
        <PreviewFrame width={APP_WIDTH} height={APP_HEIGHT}>
          <PreviewShell sidebar="documents">
            <EditorPane variant="citations" />
            <DictationPanel />
          </PreviewShell>
        </PreviewFrame>
      );
    case "connect":
      return (
        <PreviewFrame width={APP_WIDTH} height={APP_HEIGHT}>
          <PreviewShell sidebar="graph">
            <GraphPane />
          </PreviewShell>
        </PreviewFrame>
      );
    case "together":
      return (
        <PreviewFrame width={APP_WIDTH} height={APP_HEIGHT}>
          <PreviewShell sidebar="settings">
            <MembersPane />
          </PreviewShell>
        </PreviewFrame>
      );
  }
}

export function DiscoverDemo() {
  return (
    <AnswerDemo
      panels={[
        {
          key: "query",
          tab: "근거 있는 답변",
          description: "채팅 패널에서 질문하면 실행 단계, 찾은 자료, 근거 번호가 붙은 답변이 차례로 표시되는 화면 예시입니다.",
          content: (
            <PreviewFrame width={DEMO_WIDTH} height={DEMO_HEIGHT}>
              <PreviewShell sidebar="documents">
                <EditorPane variant="citations" />
                <ChatPanel />
              </PreviewShell>
            </PreviewFrame>
          )
        },
        {
          key: "edit",
          tab: "AI 문서 편집",
          description: "AI가 본문에 제안한 수정 내용을 문서와 작업 탭에서 확인하고 수락하거나 거절하는 화면 예시입니다.",
          content: (
            <PreviewFrame width={DEMO_WIDTH} height={DEMO_HEIGHT}>
              <PreviewShell sidebar="documents">
                <EditorPane variant="suggestion" />
                <TaskPanel />
              </PreviewShell>
            </PreviewFrame>
          )
        },
        {
          key: "skill",
          tab: "AI 스킬",
          description: "자주 하는 작업을 스킬로 만들어 팀과 개인 범위로 저장하고 실행하는 스킬 목록 화면 예시입니다.",
          content: (
            <PreviewFrame width={DEMO_WIDTH} height={DEMO_HEIGHT}>
              <PreviewShell sidebar="documents" view="skills">
                <SkillsPane />
              </PreviewShell>
            </PreviewFrame>
          )
        }
      ]}
    />
  );
}
