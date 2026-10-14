// useBackendData가 react-query에 넘기는 옵션과 돌려받는 상태를 테스트가 직접 다루기 위한 가짜.
// 쿼리는 queryKey의 마지막 조각("documents" | "graph")으로 구분한다.
export const queries = {
  documents: { data: undefined, error: null, isLoading: true, dataUpdatedAt: 0 },
  graph: { data: undefined, error: null, isLoading: true, dataUpdatedAt: 0 }
};
/** 마지막 렌더에서 각 쿼리에 넘긴 옵션. */
export const lastOptions = {};
/** refetch 호출 기록: [쿼리 이름, 옵션]. */
export const refetchCalls = [];
/** setQueryData 호출 기록: [queryKey, 갱신 결과]. */
export const setQueryDataCalls = [];

export function resetFakeQueries() {
  for (const name of Object.keys(queries)) {
    queries[name] = { data: undefined, error: null, isLoading: true, dataUpdatedAt: 0 };
  }
  for (const key of Object.keys(lastOptions)) delete lastOptions[key];
  refetchCalls.length = 0;
  setQueryDataCalls.length = 0;
}

export function useQuery(options) {
  const name = options.queryKey.at(-1);
  lastOptions[name] = options;
  const state = queries[name];
  return {
    ...state,
    refetch: async (refetchOptions) => {
      refetchCalls.push([name, refetchOptions]);
      return { data: queries[name].data };
    }
  };
}

export function useQueryClient() {
  return {
    setQueryData(queryKey, updater) {
      const name = queryKey.at(-1);
      const next = typeof updater === "function" ? updater(queries[name].data) : updater;
      queries[name] = { ...queries[name], data: next };
      setQueryDataCalls.push([queryKey, next]);
    }
  };
}
