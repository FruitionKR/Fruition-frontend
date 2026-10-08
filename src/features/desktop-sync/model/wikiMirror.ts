import type { WikiGraphNodeResponse } from "@/entities/wiki/model/wiki";
import type { LocalFolderPort, SyncApi, SyncStatePort } from "@/features/desktop-sync/model/syncEngine";

/** AI가 만든 위키 페이지를 두는 숨김 폴더. Finder와 Obsidian은 기본으로 보여주지 않는다(2026-10-09 결정). */
export const WIKI_MIRROR_ROOT = ".fruition/wiki";

const MAX_NAME_LENGTH = 120;

export type WikiMirrorPlan = {
  /** 페이지 id → 연결 폴더 기준 파일 경로. */
  paths: Record<string, string>;
  /** 사라졌거나 경로가 바뀐 페이지의 옛 파일. */
  removes: string[];
};

/**
 * 위키 그래프의 페이지마다 미러 파일 경로를 정한다. 파일명은 페이지 제목이고,
 * 같은 폴더에 같은 이름이 있으면 실행마다 같은 결과가 나오도록 id 순서로 번호를 붙인다.
 */
export function planWikiMirror(input: { nodes: WikiGraphNodeResponse[]; previous: Record<string, string> }): WikiMirrorPlan {
  const paths: Record<string, string> = {};
  const taken = new Set<string>();
  const nodes = [...input.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const node of nodes) {
    const folder = `${WIKI_MIRROR_ROOT}/${node.page_type === "concept" ? "concept" : "source"}`;
    const name = toFileName(node.title) || toFileName(node.slug) || node.id;
    let path = `${folder}/${name}.md`;
    for (let suffix = 2; taken.has(path.toLowerCase()); suffix += 1) path = `${folder}/${name} (${suffix}).md`;
    taken.add(path.toLowerCase());
    paths[node.id] = path;
  }
  const removes = Object.entries(input.previous)
    .filter(([pageId, path]) => paths[pageId] !== path)
    .map(([, path]) => path);
  return { paths, removes };
}

/** 파일명에 쓸 수 없는 문자를 바꾸고 NFC로 맞춘다. 숨김 파일이 되지 않게 앞의 점을 뗀다. */
function toFileName(title: string): string {
  return title
    .normalize("NFC")
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

export type WikiMirrorDeps = {
  workspaceId: string;
  local: Pick<LocalFolderPort, "writeText" | "trash">;
  state: SyncStatePort;
  api: Pick<SyncApi, "fetchSyncWikiChangedAt" | "fetchSyncWikiGraph" | "fetchSyncWikiPage">;
};

/**
 * 위키가 바뀌었으면 모든 페이지를 미러 파일로 다시 쓴다. 페이지별 revision이 없어(FruitionKR/Fruition-document#75)
 * 바뀐 페이지만 고를 수 없다. 중간에 실패하면 상태를 남기지 않으므로 다음 실행이 처음부터 다시 받는다.
 */
export async function runWikiMirror(deps: WikiMirrorDeps): Promise<void> {
  const { api, local, workspaceId } = deps;
  const before = await deps.state.load();
  const changedAt = await api.fetchSyncWikiChangedAt(workspaceId);
  if (before.wiki && changedAt !== null && changedAt === before.wiki.lastChangeAt) return;

  const graph = await api.fetchSyncWikiGraph(workspaceId);
  const plan = planWikiMirror({ nodes: graph.nodes, previous: before.wiki?.paths ?? {} });
  for (const [pageId, path] of Object.entries(plan.paths)) {
    const page = await api.fetchSyncWikiPage(workspaceId, pageId);
    await local.writeText(path, page.markdown ?? page.summary ?? "");
  }
  for (const path of plan.removes) await local.trash(path);
  // 동기화 주기가 그사이 상태를 바꿨을 수 있으므로 저장 직전에 다시 읽는다.
  const latest = await deps.state.load();
  await deps.state.save({ ...latest, wiki: { lastChangeAt: changedAt, paths: plan.paths } });
}
