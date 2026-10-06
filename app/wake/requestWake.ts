// 서버 전용: AWS SDK를 쓰므로 app/wake/route.ts 외에서 import하지 않는다(src/는 app/을 import하지 않아 브라우저 번들에 섞이지 않는다).
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

export type WakePhase = "asleep" | "sleeping" | "waking" | "awake" | "unknown";

const KNOWN_PHASES = new Set<WakePhase>(["asleep", "sleeping", "waking", "awake"]);
// 발행에 성공하면 60초 동안 다시 보내지 않는다. 실패하면 10초 뒤부터 재시도해 일시 오류(자격 증명 첫 조회 등)를 넘기되
// 로그 폭주는 막는다(Pod당 최대 분당 6건).
const DEDUPE_WINDOW_MS = 60_000;
const RETRY_BACKOFF_MS = 10_000;
const AWS_TIMEOUT_MS = 3_000;

let lastSucceededAt: number | null = null;
let lastFailedAt: number | null = null;
let inFlight: Promise<void> | null = null;
let hasWarnedDisabled = false;
let eventBridge: EventBridgeClient | null = null;
let dynamo: DynamoDBClient | null = null;

/** 기동 이벤트를 보낸다. 성공 뒤 60초·실패 뒤 10초 안 요청은 건너뛰고, 어떤 실패도 던지지 않는다. */
export async function requestWake(): Promise<void> {
  const source = process.env.REQUEST_WAKE_EVENT_SOURCE?.trim();
  const detailType = process.env.REQUEST_WAKE_DETAIL_TYPE?.trim();
  if (!source || !detailType) {
    if (!hasWarnedDisabled) console.warn("[wake] REQUEST_WAKE_EVENT_SOURCE/DETAIL_TYPE 미설정: 기동 요청을 보내지 않는다");
    hasWarnedDisabled = true;
    return;
  }

  // 발행 중에 들어온 요청은 같은 발행을 기다린다. 동시 요청도 이벤트는 한 건만 나간다.
  if (inFlight) return inFlight;
  const now = Date.now();
  if (lastSucceededAt !== null && now - lastSucceededAt < DEDUPE_WINDOW_MS) return;
  if (lastFailedAt !== null && now - lastFailedAt < RETRY_BACKOFF_MS) return;

  inFlight = publishWakeEvent(source, detailType)
    .then((ok) => {
      if (ok) lastSucceededAt = now;
      else lastFailedAt = now;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function publishWakeEvent(source: string, detailType: string): Promise<boolean> {
  try {
    eventBridge ??= new EventBridgeClient({});
    const result = await eventBridge.send(
      new PutEventsCommand({ Entries: [{ Source: source, DetailType: detailType, Detail: "{}" }] }),
      { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) }
    );
    if (!result.FailedEntryCount) return true;
    console.error("[wake] 기동 이벤트 발행 실패", result.Entries?.[0]?.ErrorCode);
    return false;
  } catch (error) {
    console.error("[wake] 기동 이벤트 발행 실패", error);
    return false;
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
