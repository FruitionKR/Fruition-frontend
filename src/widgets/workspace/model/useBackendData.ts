import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { documentDataQueryKey, fetchDocumentData, fetchWikiGraph } from "@/entities/wiki";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { projectsFromServerTree } from "@/entities/tree/lib/serverTree";
import type { DocumentItemResponse } from "@/entities/document";
import { isDocumentInFlight } from "@/entities/document/lib/documentKind";
import type { Project } from "@/entities/tree";
import type { BackendData, WikiGraphResponse } from "@/entities/wiki";
import { getWikiWorkPollInterval, isStaleForIdlePoll } from "@/features/wiki-ingest/model/wikiWorkPolling";
import { usePageVisible } from "@/shared/lib/usePageVisible";

const EMPTY_GRAPH: WikiGraphResponse = { nodes: [], edges: [] };
type DocumentData = Pick<BackendData, "documents" | "tree">;

function hasProcessingDocuments(data: DocumentData | undefined) {
  return (data?.documents ?? []).some((document) => isDocumentInFlight(document.status));
}

export function useBackendData({
  setProjects
}: {
  setProjects: Dispatch<SetStateAction<Project[]>>;
}) {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const isPageVisible = usePageVisible();
  const query = useQuery({
    queryKey: documentDataQueryKey(workspaceId),
    queryFn: fetchDocumentData,
    enabled: Boolean(workspaceId),
    refetchInterval: (activeQuery) =>
      getWikiWorkPollInterval(hasProcessingDocuments(activeQuery.state.data), isPageVisible),
    // 처리 중인 문서가 있으면 숨김 탭에서도 느리게 폴링해 완료 브라우저 알림을 띄운다.
    refetchIntervalInBackground: true,
    // 숨김 탭에서 멈춰 있던 동안 오래된 데이터만 복귀 즉시 다시 받는다.
    refetchOnWindowFocus: (activeQuery) => isStaleForIdlePoll(activeQuery.state.dataUpdatedAt)
  });
  const graphQuery = useQuery({
    queryKey: ["backendData", workspaceId, "graph"],
    queryFn: fetchWikiGraph,
    enabled: Boolean(workspaceId),
    refetchInterval: getWikiWorkPollInterval(hasProcessingDocuments(query.data), isPageVisible),
    // 그래프는 알림에 쓰이지 않으므로 숨김 탭에서는 멈추고, 복귀할 때 오래된 경우만 다시 받는다(#66).
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (activeQuery) => isStaleForIdlePoll(activeQuery.state.dataUpdatedAt)
  });

  const backendData = query.data;

  // 백엔드 데이터가 갱신될 때 프로젝트 트리에 병합한다.
  useEffect(() => {
    if (!backendData?.tree) return;
    setProjects((current) => projectsFromServerTree(backendData.tree!, current));
  }, [backendData, setProjects]);

  const { refetch } = query;
  const { refetch: refetchGraph } = graphQuery;
  const refreshBackendData = useCallback(async (options?: { throwOnError?: boolean }) => {
    const [documentsResult] = await Promise.all([refetch({ throwOnError: options?.throwOnError }), refetchGraph()]);
    // 트리 변경 큐의 다음 작업이 렌더를 기다리지 않고 최신 트리를 보도록 바로 병합한다.
    // 위 effect가 같은 데이터로 다시 병합해도 결과는 같다.
    const tree = documentsResult.data?.tree;
    if (tree) setProjects((current) => projectsFromServerTree(tree, current));
  }, [refetch, refetchGraph, setProjects]);

  /** 업로드 낙관적 갱신용: query cache의 documents를 직접 수정한다. */
  const setDocuments = useCallback(
    (action: SetStateAction<DocumentItemResponse[]>) => {
      queryClient.setQueryData<DocumentData>(documentDataQueryKey(workspaceId), (current) => {
        const base = current ?? { documents: [] };
        const nextDocuments = typeof action === "function" ? action(base.documents) : action;
        return { ...base, documents: nextDocuments };
      });
    },
    [queryClient, workspaceId]
  );

  return {
    documents: backendData?.documents ?? [],
    /** 문서 목록을 서버에서 마지막으로 받은 시각. 응답 내용이 같아도 갱신된다. */
    documentsUpdatedAt: query.dataUpdatedAt,
    setDocuments,
    wikiGraph: graphQuery.data ?? EMPTY_GRAPH,
    isGraphLoading: graphQuery.isLoading,
    apiError: query.error || graphQuery.error ? getErrorMessage(query.error ?? graphQuery.error, "백엔드 데이터를 불러오지 못했습니다.") : null,
    refreshBackendData
  };
}
