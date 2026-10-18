import { apiFetch, parseJsonOrThrow, throwIfNotOk, workspacePath } from "@/shared/api/client";
import type {
  SkillAuthoringRequest,
  SkillAuthoringResult,
  SkillPublishRequest,
  SkillResponse,
  SkillTestRunRequest,
  SkillTestRunResponse,
  SkillUpdateRequest
} from "@/entities/skill/model/skill";

/** 테스트 실행 응답 대기 상한. 서버는 60초에 503으로 끊으므로 그보다 조금 길게 기다린다. */
const SKILL_TEST_RUN_TIMEOUT_MS = 75_000;

export async function fetchSkills(workspaceId: string): Promise<SkillResponse[]> {
  const response = await apiFetch(workspacePath(workspaceId, "skills"), { cache: "no-store" });
  return parseJsonOrThrow<SkillResponse[]>(response, "스킬 목록을 불러오지 못했습니다.");
}

export async function authorSkill(workspaceId: string, body: SkillAuthoringRequest): Promise<SkillAuthoringResult> {
  const response = await apiFetch(workspacePath(workspaceId, "skills", "author"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonOrThrow<SkillAuthoringResult>(response, "스킬 초안을 생성하지 못했습니다.");
}

export async function publishSkill(workspaceId: string, body: SkillPublishRequest): Promise<SkillAuthoringResult> {
  const response = await apiFetch(workspacePath(workspaceId, "skills", "author", "publish"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonOrThrow<SkillAuthoringResult>(response, "스킬을 게시하지 못했습니다.");
}

/**
 * 게시 전 Skill 정의를 문서 하나에 저장하지 않고 적용해 본다.
 * run_id는 한 번만 쓸 수 있어(같은 값이면 409) 호출마다 새로 만든다. 다시 테스트할 때도 새 run_id다.
 */
export async function testRunSkill(
  workspaceId: string,
  body: SkillTestRunRequest,
  runId: string
): Promise<SkillTestRunResponse> {
  const path = `${workspacePath(workspaceId, "skills", "test-run")}?run_id=${encodeURIComponent(runId)}`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SKILL_TEST_RUN_TIMEOUT_MS)
  });
  return parseJsonOrThrow<SkillTestRunResponse>(response, "스킬을 테스트하지 못했습니다.");
}

export async function updateSkill(
  workspaceId: string,
  skillId: string,
  body: SkillUpdateRequest
): Promise<SkillAuthoringResult> {
  const response = await apiFetch(workspacePath(workspaceId, "skills", skillId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonOrThrow<SkillAuthoringResult>(response, "스킬 정의를 수정하지 못했습니다.");
}

export async function enableSkill(workspaceId: string, skillId: string): Promise<SkillResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "skills", skillId, "enable"), { method: "POST" });
  return parseJsonOrThrow<SkillResponse>(response, "스킬을 활성화하지 못했습니다.");
}

export async function deleteSkill(workspaceId: string, skillId: string): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, "skills", skillId), {
    method: "DELETE"
  });
  await throwIfNotOk(response, "스킬을 삭제하지 못했습니다.");
}
