/** Query와 Agent turn이 공유하는 SSE 진행 이벤트. */
export type RunStageEvent = { stage: string; message: string; sequence: number };

/** SSE 프레임(event/data 줄) 한 개를 파싱한다. heartbeat(':' 주석)는 무시한다. */
function parseSseFrame(raw: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/** 완료 전에도 단계별 콜백을 호출한다. 연결이 끝나면 호출자가 저장된 최종 상태를 조회한다. */
export async function readRunEvents(
  response: Response,
  onStage: (event: RunStageEvent) => void,
  failureMessage: string
): Promise<"completed" | "cancelled" | "closed"> {
  if (!response.body) throw new Error(failureMessage);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastSequence = -1;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return "closed";
      buffer += decoder.decode(value, { stream: true });
      let separator = /\r?\n\r?\n/.exec(buffer);
      while (separator) {
        const frame = parseSseFrame(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
        if (frame?.event === "query.log") {
          const payload = frame.data as Partial<RunStageEvent>;
          if (typeof payload.sequence === "number" && payload.sequence > lastSequence
            && typeof payload.stage === "string" && typeof payload.message === "string") {
            lastSequence = payload.sequence;
            onStage({ stage: payload.stage, message: payload.message, sequence: payload.sequence });
          }
        } else if (frame?.event === "query.completed") {
          return "completed";
        } else if (frame?.event === "query.cancelled") {
          return "cancelled";
        } else if (frame?.event === "query.failed") {
          throw new Error((frame.data as { error?: string }).error || failureMessage);
        }
        separator = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
