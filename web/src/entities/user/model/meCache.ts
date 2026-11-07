import { hashKey, type QueryClient } from "@tanstack/react-query";
import type { UserMeResponse } from "./user";
import { ME_QUERY_KEY } from "./useMe";

const ME_QUERY_HASH = hashKey(ME_QUERY_KEY);

/** me 캐시에 지금 들어 있는 값. 조회를 시작하지 않는다. */
export function readCachedMe(queryClient: QueryClient): UserMeResponse | undefined {
  return queryClient.getQueryData<UserMeResponse>(ME_QUERY_KEY);
}

/**
 * me 캐시가 바뀔 때마다 listener를 부른다. query 하나에 붙는 observer와 달리 queryCache 전체를 구독해,
 * 로그인 흐름이 queryClient.clear()로 me query를 지운 뒤 새로 만든 me query의 결과도 받는다.
 * 조회를 시작하지 않으므로 OAuth 콜백 중 me 자동 조회를 막는 처리(#254)와 부딪히지 않는다.
 */
export function subscribeToMeCache(queryClient: QueryClient, listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === ME_QUERY_HASH) listener();
  });
}
