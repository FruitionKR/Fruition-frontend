import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { isOperationPurged, planOperationResultLabel, agentPlanClarificationMessage, agentPlanFailureMessage, agentPlanStatusLabel, canRetryAgentPlanRun, planOperationOutcome, splitPlanSummary, summarizePlanOperationResults, buildPlanPreviewTree, canApproveAgentPlan, describePlanOperations, isPlanRunSettled, knownPlanRunId, shouldPollAgentPlan } from "../src/features/agent-chat/lib/agentPlan.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});
const { fetchAgentPlanRun, fetchAgentRunEditPreviews, decideAgentPlan } = await import("../src/features/agent-chat/api/agentPlan.ts");
const plan = { id: "plan-1", version: 2, operation_hash: "a".repeat(64), status: "awaiting_approval", operations: [] };

test("채팅 기록의 turn ID에서 실제 승인 대상 run을 조회한다", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return Response.json(paths.length === 1
      ? { status: "completed", result: { run_id: "autonomous-1" } }
      : { id: "autonomous-1", status: "awaiting_approval", plan });
  });
  assert.equal((await fetchAgentPlanRun("ws_test", "turn-1")).plan.version, 2);
  assert.deepEqual(paths, ["/api/workspaces/ws_test/agent/turn/turn-1", "/api/workspaces/ws_test/agent/runs/autonomous-1"]);
});

test("이미 받은 run이 있으면 다음 폴링은 turn을 다시 묻지 않고 run만 조회한다", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return Response.json({ id: "autonomous-1", status: "awaiting_approval", plan });
  });
  const previous = { id: "autonomous-1", status: "awaiting_approval", error_code: null, plan };
  assert.equal(knownPlanRunId(previous, "turn-1"), "autonomous-1");
  assert.equal((await fetchAgentPlanRun("ws_test", "turn-1", undefined, knownPlanRunId(previous, "turn-1"))).status, "awaiting_approval");
  assert.deepEqual(paths, ["/api/workspaces/ws_test/agent/runs/autonomous-1"]);
  // 아직 못 받았거나 turn 취소 상태만 담은 결과(id가 turn ID)는 turn부터 다시 묻는다.
  assert.equal(knownPlanRunId(undefined, "turn-1"), null);
  assert.equal(knownPlanRunId(null, "turn-1"), null);
  assert.equal(knownPlanRunId({ id: "turn-1", status: "cancel_requested", error_code: null, plan: null }, "turn-1"), null);
});

test("승인은 화면에서 검토한 버전·해시를 전송하고 충돌을 성공으로 처리하지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/agent/runs/autonomous-1/approve");
    assert.equal(init.method, "POST");
    assert.ok(init.headers.get("Idempotency-Key"));
    assert.deepEqual(JSON.parse(init.body), { plan_version: 2, operation_hash: "a".repeat(64) });
    return Response.json({ detail: "계획이 변경되었습니다." }, { status: 409 });
  });
  await assert.rejects(decideAgentPlan("ws_test", "autonomous-1", "approve", plan), /계획이 변경/);
});

test("부분 승인은 고른 작업 id를 operation_ids로 보내고 400을 선택 오류로 알린다", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? Response.json({ id: "autonomous-1", status: "executing", plan: null })
      : Response.json({ detail: "selected operations depend on unselected" }, { status: 400 });
  });
  assert.equal((await decideAgentPlan("ws_test", "autonomous-1", "approve", plan, ["op-1", "op-3"])).status, "executing");
  await assert.rejects(decideAgentPlan("ws_test", "autonomous-1", "approve", plan, ["op-3"]), /함께 적용해야 하는 항목/);
  assert.deepEqual(bodies, [
    { plan_version: 2, operation_hash: "a".repeat(64), operation_ids: ["op-1", "op-3"] },
    { plan_version: 2, operation_hash: "a".repeat(64), operation_ids: ["op-3"] }
  ]);
});

test("거절은 승인 endpoint를 호출하지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.ok(path.endsWith("/reject"));
    assert.equal(init.body, undefined);
    return Response.json({ status: "rejected", plan: null });
  });
  assert.equal((await decideAgentPlan("ws_test", "autonomous-1", "reject", plan)).status, "rejected");
});

test("계획 준비 중에는 폴링하고 누락된 실행 ID는 오류로 알린다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "queued", result: null }));
  assert.equal(await fetchAgentPlanRun("ws_test", "turn-1"), null);
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "completed", result: {} }));
  await assert.rejects(fetchAgentPlanRun("ws_test", "turn-1"), /계획 정보를 찾을 수 없습니다/);
});

test("turn이 취소 중이면 폴링을 이어 가고, 취소됨·복구 실패면 폴링을 멈추고 라벨을 보여 준다(#141)", async (t) => {
  let turnStatus = "cancel_requested";
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.equal(path, "/api/workspaces/ws_test/agent/turn/turn-1");
    return Response.json({ status: turnStatus, result: null, error_code: turnStatus === "rollback_failed" ? "rollback_conflict" : null });
  });
  for (const status of ["cancel_requested", "rolling_back"]) {
    turnStatus = status;
    const run = await fetchAgentPlanRun("ws_test", "turn-1");
    assert.equal(run.status, status);
    assert.equal(run.plan, null);
    assert.equal(shouldPollAgentPlan(run.status), true);
  }
  assert.equal(agentPlanStatusLabel("cancel_requested"), "취소 요청 중");
  assert.equal(agentPlanStatusLabel("rolling_back"), "변경 복구 중");
  turnStatus = "rollback_failed";
  const failed = await fetchAgentPlanRun("ws_test", "turn-1");
  assert.deepEqual(failed, { id: "turn-1", status: "rollback_failed", plan: null, error_code: "rollback_conflict" });
  assert.equal(shouldPollAgentPlan(failed.status), false);
  assert.equal(agentPlanStatusLabel(failed.status), "변경 복구 실패");
  turnStatus = "cancelled";
  const cancelled = await fetchAgentPlanRun("ws_test", "turn-1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(shouldPollAgentPlan(cancelled.status), false);
  assert.equal(agentPlanStatusLabel(cancelled.status), "취소됨");
});

test("승인 대기를 완료와 구분하고 종료·충돌 상태에서는 승인하지 않는다", () => {
  assert.equal(agentPlanStatusLabel("awaiting_approval"), "승인 대기");
  assert.equal(canApproveAgentPlan({ status: "awaiting_approval", plan }), true);
  for (const status of ["completed", "failed", "partial_failed", "conflicted", "rejected", "cancelled", "clarification_required"]) {
    assert.equal(canApproveAgentPlan({ status, plan }), false);
    assert.equal(shouldPollAgentPlan(status), false);
  }
  assert.equal(canApproveAgentPlan({ status: "awaiting_approval", plan: { ...plan, status: "approved" } }), false);
  assert.equal(shouldPollAgentPlan("executing"), true);
});

test("작업 순서대로 새 폴더 참조와 문서 이동 경로를 이름으로 표시한다", () => {
  const operations = [
    { id: "move", sequence: 3, tool_name: "move_document", target_id: "doc-1", arguments: { folder_id: { $operation_result: "child", field: "id" } } },
    { id: "child", sequence: 2, tool_name: "create_folder", arguments: { name: "관수", parent_folder_id: { $operation_result: "parent", field: "id" } } },
    { id: "parent", sequence: 1, tool_name: "create_folder", arguments: { name: "재배 관리", parent_folder_id: null } }
  ];
  const rows = describePlanOperations({ ...plan, operations }, [{ id: "old", name: "미분류", children: [{ id: "doc-1", name: "토마토.pdf" }] }]);
  assert.deepEqual(rows.map((row) => row.description), [
    "폴더 생성: 재배 관리", "폴더 생성: 재배 관리 / 관수", "미분류 / 토마토.pdf → 재배 관리 / 관수"
  ]);
});

test("새 폴더 아래에 이동 문서를 묶고 한글 표시만 정규화한다", () => {
  const filename = "운영 가이드.md".normalize("NFD");
  const tree = [{ id: "doc-1", name: filename }, { id: "other", name: "무관한 문서" }];
  const operations = [
    { id: "move", sequence: 2, tool_name: "move_document", target_id: "doc-1", arguments: { folder_id: { $operation_result: "create", field: "id" } } },
    { id: "create", sequence: 1, tool_name: "create_folder", arguments: { name: "운영", parent_folder_id: null } }
  ];
  const preview = buildPlanPreviewTree({ ...plan, operations }, tree);
  assert.equal(preview.summary, "폴더 1개 생성 · 문서 1개 이동");
  assert.equal(preview.nodes.length, 1);
  assert.equal(preview.nodes[0].name, "운영");
  assert.equal(preview.nodes[0].isNew, true);
  assert.equal(preview.nodes[0].children[0].name, "운영 가이드.md");
  assert.equal(tree[0].name, filename);
});

test("이름이 같은 기존 폴더도 ID로 구분하고 중첩 폴더·최상위 이동을 표시한다", () => {
  const tree = [
    { id: "a", name: "자료", children: [{ id: "doc-1", name: "문서.md" }] },
    { id: "b", name: "자료", children: [] }
  ];
  const operations = [
    { id: "create", sequence: 1, tool_name: "create_folder", arguments: { name: "분류", parent_folder_id: "b" } },
    { id: "move", sequence: 2, tool_name: "move_document", target_id: "doc-1", arguments: { folder_id: null } }
  ];
  const preview = buildPlanPreviewTree({ ...plan, operations }, tree);
  assert.deepEqual(preview.nodes.map((node) => node.id), ["b", "doc-1"]);
  assert.equal(preview.nodes[0].children[0].name, "분류");
});

test("계획 완료 갱신은 같은 화면에서 진행 중 → 종료 전이를 볼 때만 한다", () => {
  assert.equal(isPlanRunSettled("executing", "succeeded"), true);
  assert.equal(isPlanRunSettled("awaiting_approval", "rejected"), true);
  // 이미 끝난 계획이 다시 마운트되거나 같은 상태로 다시 렌더될 때는 갱신하지 않는다.
  assert.equal(isPlanRunSettled(undefined, "succeeded"), false);
  assert.equal(isPlanRunSettled("succeeded", "succeeded"), false);
  assert.equal(isPlanRunSettled("executing", "verifying"), false);
  assert.equal(isPlanRunSettled("executing", undefined), false);
});

test("명확화 요청이면 AI가 되물은 질문을 보이고, 질문이 없으면 기본 안내를 쓴다", () => {
  const question = "각 문서의 생성일 정보가 없어 날짜별로 폴더를 만들 수 없습니다.";
  assert.equal(agentPlanClarificationMessage({ status: "clarification_required", clarification_question: question, plan: null }), question);
  for (const clarification_question of [undefined, null, "", "   "]) {
    assert.equal(agentPlanClarificationMessage({ status: "clarification_required", clarification_question, plan: null }), "원하는 정리 기준을 작업 입력창에 더 구체적으로 알려주세요.");
  }
  assert.equal(agentPlanClarificationMessage({ status: "failed", clarification_question: question, plan: null }), null);
  assert.equal(agentPlanClarificationMessage(undefined), null);
});

test("완료된 계획은 실제로 저장된 작업만 세고 고르지 않은·실패한 작업은 따로 센다", () => {
  const op = (status, error_code = null) => ({ status, error_code });
  assert.deepEqual(
    summarizePlanOperationResults([op("succeeded"), op("succeeded"), op("completed"), op("skipped", "not_selected")]),
    { applied: 3, excluded: 1, failed: 0 }
  );
  assert.deepEqual(
    summarizePlanOperationResults([op("succeeded"), op("failed"), op("skipped", "not_selected")]),
    { applied: 1, excluded: 1, failed: 1 }
  );
  // 승인 직후 캐시처럼 결과 상태가 아직 없으면 고르지 않은 작업만 뺀다.
  assert.deepEqual(
    summarizePlanOperationResults([op("planned"), op("planned"), op("skipped", "not_selected")]),
    { applied: 2, excluded: 1, failed: 0 }
  );
  assert.deepEqual(summarizePlanOperationResults([]), { applied: 0, excluded: 0, failed: 0 });
});

test("실패한 run은 error_code별 이유를 보여 주고 모르는 코드는 기본 안내를 쓴다", () => {
  const failed = (error_code, plan = null) => ({ status: "failed", error_code, plan });
  assert.equal(
    agentPlanFailureMessage(failed("plan_out_of_scope")),
    "선택한 폴더 밖으로 옮기거나 선택한 폴더 자체를 바꾸는 작업만 있어 정리 계획을 만들지 못했어요. 규칙을 조정해 다시 시도해 주세요."
  );
  assert.match(agentPlanFailureMessage(failed("input_rejected")), /검증을 통과하지 못해.*다시 시도해 주세요/);
  assert.match(agentPlanFailureMessage(failed("provider_rate_limited")), /잠시 후 다시 시도/);
  assert.match(agentPlanFailureMessage(failed("provider_unavailable")), /연결하지 못해/);
  assert.match(agentPlanFailureMessage(failed("deadline_exceeded")), /오래 걸려/);
  assert.equal(agentPlanFailureMessage(failed("internal_error")), "작업을 완료하지 못했습니다. 다시 시도해 주세요.");
  assert.equal(agentPlanFailureMessage(failed(null)), "작업을 완료하지 못했습니다. 다시 시도해 주세요.");
  // 카드와 미리보기가 같은 문구를 쓰므로 어느 화면을 가리키지 않는다.
  assert.equal(agentPlanFailureMessage({ status: "partial_failed", error_code: null, plan }), "일부 작업을 완료하지 못했어요. 항목별 결과를 확인해 주세요.");
  assert.equal(agentPlanFailureMessage({ status: "failed", error_code: null, plan }), "작업을 완료하지 못했어요. 항목별 결과를 확인해 주세요.");
  assert.equal(agentPlanFailureMessage({ status: "completed", error_code: null, plan }), null);
  assert.equal(agentPlanFailureMessage(null), null);
});

test("계획 단계에서 실패해 실행된 작업이 없는 run만 다시 시도할 수 있다", () => {
  assert.equal(canRetryAgentPlanRun({ status: "failed", plan: null }), true);
  assert.equal(canRetryAgentPlanRun({ status: "failed", plan }), false, "실행 중 실패는 다시 보내면 중복 변경이 생길 수 있다");
  assert.equal(canRetryAgentPlanRun({ status: "partial_failed", plan: null }), false);
  assert.equal(canRetryAgentPlanRun({ status: "completed", plan: null }), false);
  assert.equal(canRetryAgentPlanRun(null), false);
});

test("계획 요약 끝의 범위 밖 제외 안내를 따로 떼어 낸다", () => {
  assert.deepEqual(
    splitPlanSummary("회의록 3개를 날짜 폴더로 옮깁니다. 대상 폴더 밖으로 옮기는 작업 2개는 계획에서 뺐어요."),
    { body: "회의록 3개를 날짜 폴더로 옮깁니다.", scopeNote: "대상 폴더 밖으로 옮기는 작업 2개는 계획에서 뺐어요." }
  );
  assert.deepEqual(splitPlanSummary("문서 2개 이동"), { body: "문서 2개 이동", scopeNote: null });
  assert.deepEqual(splitPlanSummary(undefined), { body: "", scopeNote: null });
});

test("계획 요약 끝의 대상 폴더 자체 제외 안내도 떼어 내고, 범위 밖 제외 안내와 나온 순서대로 잇는다", () => {
  const self = "대상 폴더 자체는 바꿀 수 없어 그 폴더의 이름 변경·이동 작업 1개는 계획에서 뺐어요.";
  assert.deepEqual(
    splitPlanSummary(`회의록 3개를 날짜 폴더로 옮깁니다. ${self}`),
    { body: "회의록 3개를 날짜 폴더로 옮깁니다.", scopeNote: self }
  );
  const scope = "대상 폴더 밖으로 옮기는 작업 2개는 계획에서 뺐어요.";
  assert.deepEqual(
    splitPlanSummary(`문서 2개 이동. ${scope} ${self}`),
    { body: "문서 2개 이동.", scopeNote: `${scope} ${self}` }
  );
});

test("계획 요약 끝의 내용 중복 안내 두 문장도 떼어 내고, 이름 속 마침표에서 끊지 않는다", () => {
  const pairs = "계획에 없는 문서 중 내용이 거의 같은 문서가 있어요: '회의록 v1.2.md'와(과) '회의록.md', '참고.pdf'와(과) '참고 자료.pdf'.";
  const unchecked = "문서 3개는 내용 중복을 확인하지 못했어요.";
  assert.deepEqual(
    splitPlanSummary(`문서 4개를 옮깁니다. ${pairs} ${unchecked}`),
    { body: "문서 4개를 옮깁니다.", scopeNote: `${pairs} ${unchecked}` }
  );
  assert.deepEqual(splitPlanSummary(`문서 1개 이동. ${unchecked}`), { body: "문서 1개 이동.", scopeNote: unchecked });
  // 범위 밖 제외 안내와 함께 오면 요약에 나온 순서대로 잇는다.
  const scope = "대상 폴더 밖으로 옮기는 작업 2개는 계획에서 뺐어요.";
  assert.deepEqual(
    splitPlanSummary(`문서 2개 이동. ${scope} ${pairs}`),
    { body: "문서 2개 이동.", scopeNote: `${scope} ${pairs}` }
  );
});

test("문서 수정 계획의 변경 내용을 run으로 받고, 구 서버의 404는 상태를 그대로 올린다", async (t) => {
  const paths = [];
  const responses = [
    Response.json({ items: [{ operation_id: "op-1", hunks: [] }], expires_at: null }),
    Response.json({ error: { message: "없음" } }, { status: 404 })
  ];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return responses.shift();
  });
  assert.equal((await fetchAgentRunEditPreviews("ws_test", "run-1")).items[0].operation_id, "op-1");
  assert.deepEqual(paths, ["/api/workspaces/ws_test/agent/runs/run-1/edit-previews"]);
  await assert.rejects(fetchAgentRunEditPreviews("ws_test", "run-1"), (error) => error.status === 404);
});

test("작업 결과를 저장·제외·실패·대기로 나눈다. 앞선 실패로 건너뛴 작업은 제외가 아니라 실패다", () => {
  const outcome = (status, error_code = null) => planOperationOutcome({ status, error_code });
  assert.equal(outcome("succeeded"), "applied");
  assert.equal(outcome("completed"), "applied");
  assert.equal(outcome("skipped", "not_selected"), "excluded");
  assert.equal(outcome("skipped", "dependency_failed"), "failed");
  for (const status of ["failed", "forbidden", "conflicted", "verification_failed", "cancelled", "rolled_back"]) assert.equal(outcome(status), "failed", status);
  for (const status of ["planned", "pending", "running"]) assert.equal(outcome(status), "pending", status);
  assert.deepEqual(
    summarizePlanOperationResults([{ status: "succeeded" }, { status: "forbidden" }, { status: "skipped", error_code: "dependency_failed" }, { status: "skipped", error_code: "not_selected" }]),
    { applied: 1, excluded: 1, failed: 2 }
  );
});

test("정리 후 구조는 실제 결과대로 보여 준다: 실패한 항목은 원래 자리·이름에 실패로 남고 고르지 않은 작업은 뺀다", () => {
  const tree = [
    { id: "f-a", name: "자료", type: "folder", children: [
      { id: "d-ok", name: "성공.md", type: "document" },
      { id: "d-no", name: "실패.md", type: "document" },
      { id: "d-skip", name: "제외.md", type: "document" }
    ] }
  ];
  const op = (id, sequence, tool_name, target_id, args, status, error_code = null) => ({ id, sequence, tool_name, target_id, source_parent_id: null, destination_parent_id: null, arguments: args, reason: "", status, error_code });
  const preview = buildPlanPreviewTree({ ...plan, operations: [
    op("c", 1, "create_folder", null, { name: "정리", parent_folder_id: null }, "succeeded"),
    op("m1", 2, "move_document", "d-ok", { folder_id: { $operation_result: "c" } }, "succeeded"),
    op("r1", 3, "rename_document", "d-ok", { display_name: "새 성공.md" }, "succeeded"),
    op("m2", 4, "move_document", "d-no", { folder_id: { $operation_result: "c" } }, "forbidden", "tool_http_403"),
    op("r2", 5, "rename_document", "d-no", { display_name: "계획된 이름.md" }, "skipped", "dependency_failed"),
    op("m3", 6, "move_document", "d-skip", { folder_id: { $operation_result: "c" } }, "skipped", "not_selected")
  ] }, tree);
  const flat = (nodes) => nodes.flatMap((node) => [node, ...flat(node.children)]);
  const nodes = flat(preview.nodes);
  const failed = nodes.find((node) => node.id === "d-no");
  assert.equal(failed.name, "실패.md", "계획된 이름을 쓰지 않는다");
  assert.equal(failed.failed, true);
  assert.equal(preview.nodes.find((node) => node.id === "f-a").children[0].id, "d-no", "원래 폴더에 남는다");
  const moved = nodes.find((node) => node.id === "d-ok");
  assert.equal(moved.name, "새 성공.md");
  assert.equal(moved.failed, false);
  assert.equal(preview.nodes.find((node) => node.name === "정리").children[0].id, "d-ok");
  assert.equal(nodes.some((node) => node.id === "d-skip"), false, "고르지 않은 작업은 트리에서 뺀다");
  assert.equal(preview.summary, "폴더 1개 생성 · 문서 1개 이동 · 문서 1개 이름 변경 · 실패 2개");
});

test("만들지 못한 폴더는 실패로 보여 주고 새 폴더로 표시하지 않는다", () => {
  const preview = buildPlanPreviewTree({ ...plan, operations: [
    { id: "c", sequence: 1, tool_name: "create_folder", target_id: null, source_parent_id: null, destination_parent_id: null, arguments: { name: "정리", parent_folder_id: null }, reason: "", status: "forbidden", error_code: "tool_http_403" }
  ] }, []);
  assert.deepEqual(preview.nodes.map((node) => [node.name, node.isNew, node.failed]), [["정리", false, true]]);
  assert.equal(preview.summary, "실패 1개");
});

test("실행 뒤에는 AI 요약의 '아직 변경된 사항은 없으며' 문장을 보이지 않는다", () => {
  const summary = "문서 2개를 새 폴더로 옮깁니다. 아직 변경된 사항은 없으며, 승인하면 실행됩니다. 이름도 규칙에 맞춥니다.";
  assert.equal(splitPlanSummary(summary).body, summary, "상태를 모르면 그대로 둔다");
  assert.equal(splitPlanSummary(summary, "awaiting_approval").body, summary, "승인 전에는 맞는 말이다");
  assert.equal(splitPlanSummary(summary, "rejected").body, summary, "거절했으면 여전히 맞는 말이다");
  for (const status of ["executing", "verifying", "completed", "partial_failed", "failed", "conflicted", "rollback_failed"]) {
    assert.equal(splitPlanSummary(summary, status).body, "문서 2개를 새 폴더로 옮깁니다. 이름도 규칙에 맞춥니다.", status);
  }
  assert.equal(splitPlanSummary("아직 변경된 사항은 없습니다.", "completed").body, "");
});

test("일부 실패 상태 이름을 맞춘다", () => {
  assert.equal(agentPlanStatusLabel("partial_failed"), "일부 실패");
});

test("영구 삭제로 건너뛴 작업은 고르지 않은 작업과 다른 말로 보이고, 실패로 세지 않는다", () => {
  const purged = { status: "skipped", error_code: "document_purged" };
  assert.equal(isOperationPurged(purged), true);
  assert.equal(isOperationPurged({ status: "skipped", error_code: "not_selected" }), false);
  assert.equal(planOperationResultLabel(purged), "영구 삭제됨");
  assert.equal(planOperationResultLabel({ status: "skipped", error_code: "not_selected" }), "제외됨");
  assert.equal(planOperationResultLabel({ status: "failed", error_code: null }), "실패");
  assert.equal(planOperationOutcome(purged), "excluded");
});

test("영구 삭제 문서가 있어 되돌리지 못한 run은 이유를 말한다", () => {
  assert.equal(
    agentPlanFailureMessage({ status: "rollback_failed", error_code: "rollback_document_purged", plan: { operations: [] } }),
    "영구 삭제된 문서의 변경은 되돌릴 수 없어요. 나머지 변경은 되돌렸어요."
  );
});
