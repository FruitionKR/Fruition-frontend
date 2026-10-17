import type { MeetingStatus } from "../model/meeting";

// 회의 목록(GET .../meetings) 쿼리 문자열. document docs/api/meetings.md#detail-get-api-workspaces-workspace-id-meetings

/** 서버 기본 20, 최대 100. 범위를 벗어나면 서버가 고쳐 받지만 보내기 전에 맞춘다. */
export const MEETING_LIST_DEFAULT_LIMIT = 20;
export const MEETING_LIST_MAX_LIMIT = 100;

export type MeetingListQuery = {
  statuses?: readonly MeetingStatus[];
  cursor?: string | null;
  limit?: number;
};

/**
 * "?status=open,transcribing&cursor=..&limit=20" 형식. 빈 값은 보내지 않는다.
 * 특히 `status=`(빈 문자열)는 서버가 "전부"로 읽으므로, 고른 상태가 없으면 status를 아예 빼서 뜻을 분명히 한다.
 */
export function buildMeetingListQuery({ statuses = [], cursor, limit }: MeetingListQuery = {}): string {
  const params = new URLSearchParams();
  const uniqueStatuses = [...new Set(statuses.filter(Boolean))];
  if (uniqueStatuses.length > 0) params.set("status", uniqueStatuses.join(","));
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) {
    const isValid = Number.isFinite(limit) && limit >= 1;
    params.set("limit", String(isValid ? Math.min(Math.floor(limit), MEETING_LIST_MAX_LIMIT) : MEETING_LIST_DEFAULT_LIMIT));
  }
  // 쉼표 구분 목록이라 쉼표는 그대로 둔다(계약 예시 `status=transcribing,open`).
  const query = params.toString().replace(/%2C/g, ",");
  return query ? `?${query}` : "";
}
