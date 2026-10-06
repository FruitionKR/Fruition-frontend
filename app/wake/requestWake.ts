// 서버 전용: AWS SDK를 쓰므로 app/wake/route.ts 외에서 import하지 않는다(src/는 app/을 import하지 않아 브라우저 번들에 섞이지 않는다).
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

export type WakePhase = "asleep" | "sleeping" | "waking" | "awake" | "unknown";

const KNOWN_PHASES = new Set<WakePhase>(["asleep", "sleeping", "waking", "awake"]);
const DEDUPE_WINDOW_MS = 60_000;
const AWS_TIMEOUT_MS = 3_000;

let lastRequestedAt: number | null = null;
let hasWarnedDisabled = false;
let eventBridge: EventBridgeClient | null = null;
let dynamo: DynamoDBClient | null = null;

/** 기동 이벤트를 보낸다. 60초 안 중복은 건너뛰고, 어떤 실패도 던지지 않는다. */
export async function requestWake(): Promise<void> {
  const source = process.env.REQUEST_WAKE_EVENT_SOURCE?.trim();
  const detailType = process.env.REQUEST_WAKE_DETAIL_TYPE?.trim();
  if (!source || !detailType) {
    if (!hasWarnedDisabled) console.warn("[wake] REQUEST_WAKE_EVENT_SOURCE/DETAIL_TYPE 미설정: 기동 요청을 보내지 않는다");
    hasWarnedDisabled = true;
    return;
  }

  const now = Date.now();
  if (lastRequestedAt !== null && now - lastRequestedAt < DEDUPE_WINDOW_MS) return;
  // await 전에 기록해 동시 요청도 한 건만 보낸다. 실패해도 유지해 60초 동안 재시도·로그 폭주를 막는다.
  lastRequestedAt = now;

  try {
    eventBridge ??= new EventBridgeClient({});
    const result = await eventBridge.send(
      new PutEventsCommand({ Entries: [{ Source: source, DetailType: detailType, Detail: "{}" }] }),
      { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) }
    );
    if (result.FailedEntryCount) console.error("[wake] 기동 이벤트 발행 실패", result.Entries?.[0]?.ErrorCode);
  } catch (error) {
    console.error("[wake] 기동 이벤트 발행 실패", error);
  }
}

/** 절전 상태를 읽는다. 항목이 없으면 awake, 기능 꺼짐·실패는 unknown. */
export async function readWakePhase(): Promise<WakePhase> {
  const table = process.env.REQUEST_WAKE_STATE_TABLE?.trim();
  if (!table) return "unknown";

  try {
    dynamo ??= new DynamoDBClient({});
    const { Item } = await dynamo.send(
      new GetItemCommand({
        TableName: table,
        Key: { id: { S: "controller" } },
        ProjectionExpression: "#phase",
        ExpressionAttributeNames: { "#phase": "phase" }
      }),
      { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) }
    );
    if (!Item) return "awake";
    const phase = Item.phase?.S as WakePhase | undefined;
    return phase && KNOWN_PHASES.has(phase) ? phase : "unknown";
  } catch (error) {
    console.error("[wake] 절전 상태 조회 실패", error);
    return "unknown";
  }
}
