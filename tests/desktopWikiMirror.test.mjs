import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { planWikiMirror } = await import("../src/features/desktop-sync/model/wikiMirror.ts");

const node = (id, title, page_type = "concept", slug = id) => ({ id, title, page_type, slug, status: "active" });

test("페이지 종류별 숨김 폴더에 제목을 파일명으로 쓴다", () => {
  const plan = planWikiMirror({ nodes: [node("p_1", "강화학습"), node("p_2", "논문A 요약", "source")], previous: {} });
  assert.deepEqual(plan.paths, {
    p_1: ".fruition/wiki/concept/강화학습.md",
    p_2: ".fruition/wiki/source/논문A 요약.md"
  });
  assert.deepEqual(plan.removes, []);
});

test("파일명에 쓸 수 없는 문자는 바꾸고, 제목이 비면 slug를 쓴다", () => {
  const plan = planWikiMirror({ nodes: [node("p_1", "A/B: 비교?"), node("p_2", "  ", "concept", "empty-title")], previous: {} });
  assert.equal(plan.paths.p_1, ".fruition/wiki/concept/A-B- 비교-.md");
  assert.equal(plan.paths.p_2, ".fruition/wiki/concept/empty-title.md");
});

test("같은 폴더에 같은 제목이 있으면 id 순서로 번호를 붙인다", () => {
  const plan = planWikiMirror({ nodes: [node("p_b", "개념"), node("p_a", "개념"), node("p_c", "개념", "source")], previous: {} });
  assert.deepEqual(plan.paths, {
    p_a: ".fruition/wiki/concept/개념.md",
    p_b: ".fruition/wiki/concept/개념 (2).md",
    p_c: ".fruition/wiki/source/개념.md"
  });
});

test("사라졌거나 제목이 바뀐 페이지의 옛 파일은 지운다", () => {
  const previous = { p_1: ".fruition/wiki/concept/옛 제목.md", p_gone: ".fruition/wiki/source/사라짐.md", p_2: ".fruition/wiki/concept/유지.md" };
  const plan = planWikiMirror({ nodes: [node("p_1", "새 제목"), node("p_2", "유지")], previous });
  assert.deepEqual(plan.removes.sort(), [".fruition/wiki/concept/옛 제목.md", ".fruition/wiki/source/사라짐.md"]);
});

const { runWikiMirror } = await import("../src/features/desktop-sync/model/wikiMirror.ts");

function mirrorDeps({ changedAt = "c2", state = {}, pages = {} } = {}) {
  const writes = new Map();
  const trashed = [];
  const calls = [];
  let saved = { records: [], readonlyIds: [], pendingKeys: {}, ...state };
  return {
    writes, trashed, calls, get saved() { return saved; },
    deps: {
      workspaceId: "ws_a",
      local: { async writeText(path, text) { writes.set(path, text); return ""; }, async trash(path) { trashed.push(path); } },
      state: { async load() { return saved; }, async save(next) { saved = next; } },
      api: {
        async fetchSyncWikiChangedAt(ws) { calls.push(["status", ws]); return changedAt; },
        async fetchSyncWikiGraph(ws) { calls.push(["graph", ws]); return { nodes: Object.keys(pages).map((id) => node(id, pages[id].title)), edges: [] }; },
        async fetchSyncWikiPage(ws, id) { calls.push(["page", id]); return { id, markdown: pages[id].markdown }; }
      }
    }
  };
}

test("위키가 바뀌지 않았으면 그래프를 받지 않는다", async () => {
  const run = mirrorDeps({ changedAt: "c1", state: { wiki: { lastChangeAt: "c1", paths: {} } } });
  await runWikiMirror(run.deps);
  assert.deepEqual(run.calls.map(([name]) => name), ["status"]);
});

test("위키가 바뀌면 페이지 본문을 숨김 폴더에 쓰고 옛 파일을 지운 뒤 상태를 남긴다", async () => {
  const run = mirrorDeps({
    changedAt: "c2",
    state: { wiki: { lastChangeAt: "c1", paths: { p_old: ".fruition/wiki/concept/옛 페이지.md" } } },
    pages: { p_1: { title: "개념", markdown: "# 개념\n" } }
  });
  await runWikiMirror(run.deps);
  assert.equal(run.writes.get(".fruition/wiki/concept/개념.md"), "# 개념\n");
  assert.deepEqual(run.trashed, [".fruition/wiki/concept/옛 페이지.md"]);
  assert.deepEqual(run.saved.wiki, { lastChangeAt: "c2", paths: { p_1: ".fruition/wiki/concept/개념.md" } });
});
