// usePendingWorkNotifications가 "@/entities/document"에서 쓰는 것은 위키 편입 요청 하나다.
// 실제 배럴은 업로드 전송(AWS SDK)까지 끌어오므로 호출 기록만 남기는 가짜로 바꾼다.
export const reflectCalls = [];
export let reflectFailure = null;

export function setReflectFailure(error) {
  reflectFailure = error;
}

export async function reflectDocumentToWiki(documentId, documentRole) {
  reflectCalls.push([documentId, documentRole]);
  if (reflectFailure) throw reflectFailure;
}
