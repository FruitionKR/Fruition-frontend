import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDocumentData, fetchWikiGraph } from "@/entities/wiki";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { projectsFromServerTree } from "@/entities/tree/lib/serverTree";
import type { DocumentItemResponse } from "@/entities/document";
import type { Project } from "@/entities/tree";
import type { BackendData, WikiGraphResponse } from "@/entities/wiki";
import { getWikiWorkPollInterval } from "@/features/wiki-ingest/model/wikiWorkPolling";

const EMPTY_GRAPH: WikiGraphResponse = { nodes: [], edges: [] };
type DocumentData = Pick<BackendData, "documents" | "tree">;

function hasProcessingDocuments(data: DocumentData | undefined) {
  return (data?.documents ?? []).some(
    (document) => document.status === "processing" || document.status === "uploaded"
  );
}

export function useBackendData({
  setProjects
}: {
  setProjects: Dispatch<SetStateAction<Project[]>>;
}) {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const query = useQuery({
    queryKey: ["backendData", workspaceId, "documents"],
    queryFn: fetchDocumentData,
    enabled: Boolean(workspaceId),
    refetchInterval: (activeQuery) =>
      getWikiWorkPollInterval(hasProcessingDocuments(activeQuery.state.data)),
    refetchIntervalInBackground: true,
    // 폴링으로 갱신 주기를 이미 제어하므로 탭 포커스마다 refetch하지 않는다.
    refetchOnWindowFocus: false
  });
  const graphQuery = useQuery({
    queryKey: ["backendData", workspaceId, "graph"],
    queryFn: fetchWikiGraph,
    enabled: Boolean(workspaceId),
    refetchInterval: getWikiWorkPollInterval(hasProcessingDocuments(query.data)),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false
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
    await Promise.all([refetch({ throwOnError: options?.throwOnError }), refetchGraph()]);
  }, [refetch, refetchGraph]);

  /** 업로드 낙관적 갱신용: query cache의 documents를 직접 수정한다. */
  const setDocuments = useCallback(
    (action: SetStateAction<DocumentItemResponse[]>) => {
      queryClient.setQueryData<DocumentData>(["backendData", workspaceId, "documents"], (current) => {
        const base = current ?? { documents: [] };
        const nextDocuments = typeof action === "function" ? action(base.documents) : action;
        return { ...base, documents: nextDocuments };
      });
    },
    [queryClient, workspaceId]
  );

  return {
    documents: backendData?.documents ?? [],
    setDocuments,
    wikiGraph: graphQuery.data ?? EMPTY_GRAPH,
    isGraphLoading: graphQuery.isLoading,
    apiError: query.error || graphQuery.error ? getErrorMessage(query.error ?? graphQuery.error, "백엔드 데이터를 불러오지 못했습니다.") : null,
    refreshBackendData
  };
}
