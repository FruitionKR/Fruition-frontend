import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchMeetings, type MeetingListResponse } from "@/entities/meeting";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

export const MEETING_LIST_PAGE_SIZE = 20;

/** 회의 목록 query key. 워크스페이스마다 따로 둔다. */
export const meetingListQueryKey = (workspaceId: string | null) => ["meetings", workspaceId] as const;

/**
 * 내가 만든 회의 목록(최근 생성 순, cursor 페이지). 목록을 열 때마다 새로 받는다(전사 상태가 바뀌었을 수 있다).
 * 상태 필터는 보내지 않는다(전부). 빈 status=는 보내지 않는다(buildMeetingListQuery).
 */
export function useMeetingList({ enabled = true }: { enabled?: boolean } = {}) {
  const workspaceId = getSelectedWorkspaceId();
  return useInfiniteQuery({
    queryKey: meetingListQueryKey(workspaceId),
    queryFn: ({ pageParam }) => fetchMeetings({ cursor: pageParam, limit: MEETING_LIST_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: MeetingListResponse) => lastPage.next_cursor ?? undefined,
    enabled: enabled && workspaceId !== null,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false
  });
}
