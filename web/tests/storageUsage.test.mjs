import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const storageModel = await import("../src/entities/workspace/model/storageUsage.ts");
const { describeStorageUsage, formatBytes, parseStorageUsage } = storageModel;
const { fetchStorageUsage } = await import("../src/entities/workspace/api/storage.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

test("formatBytes는 KB·MB·GB 단위와 소수 첫째 자리로 보이고 .0은 뗀다", () => {
  assert.equal(formatBytes(0), "0B");
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(1536), "1.5KB");
  assert.equal(formatBytes(5 * GB), "5GB");
  assert.equal(formatBytes(1.2 * GB), "1.2GB");
  assert.equal(formatBytes(250 * MB), "250MB");
  // 반올림으로 다음 단위가 되면 올린다.
  assert.equal(formatBytes(1024 * KB - 10), "1MB");
  assert.equal(formatBytes(-5), "0B");
});

test("describeStorageUsage: 한도가 있으면 비율과 경고(90% 이상), null이면 사용량만", () => {
  assert.deepEqual(describeStorageUsage({ used_bytes: 1.2 * GB, limit_bytes: 5 * GB }),
    { label: "내 저장 공간 1.2GB / 5GB 사용", percent: 24, isWarning: false });
  const warning = describeStorageUsage({ used_bytes: 4.5 * GB, limit_bytes: 5 * GB });
  assert.equal(warning.isWarning, true);
  assert.equal(warning.percent, 90);
  assert.equal(describeStorageUsage({ used_bytes: 6 * GB, limit_bytes: 5 * GB }).percent, 100);
  assert.deepEqual(describeStorageUsage({ used_bytes: 300 * MB, limit_bytes: null }),
    { label: "내 저장 공간 300MB 사용", percent: null, isWarning: false });
});

test("parseStorageUsage는 모양이 다른 응답을 거른다", () => {
  assert.deepEqual(parseStorageUsage({ used_bytes: 1, limit_bytes: null, scope: "user" }), { used_bytes: 1, limit_bytes: null, scope: "user" });
  assert.equal(parseStorageUsage({ used_bytes: "1", limit_bytes: 5 }), null);
  assert.equal(parseStorageUsage({ used_bytes: 1 }), null);
  assert.equal(parseStorageUsage(null), null);
});

test("fetchStorageUsage는 선택한 워크스페이스의 storage 경로를 부르고 응답을 확인한다", async (t) => {
  saveAccessToken("access-test");
  const paths = [];
  let body = { used_bytes: 10, limit_bytes: 5 * GB, scope: "user" };
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return Response.json(body);
  });
  assert.deepEqual(await fetchStorageUsage("ws_1"), body);
  assert.deepEqual(paths, ["/api/workspaces/ws_1/storage"]);
  body = { used: 1 };
  await assert.rejects(fetchStorageUsage("ws_1"), /올바르지 않습니다/);
});

/** 화면 컴포넌트를 hook 결과만 바꿔 가며 그려 본다. */
function renderMeter(queryResult) {
  const source = readFileSync(new URL("../src/widgets/document-sidebar/ui/StorageUsageMeter.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "@/entities/workspace": { ...storageModel, useStorageUsage: () => queryResult },
    "@/shared/lib/classNames": { cx: (...names) => names.filter(Boolean).join(" ") },
    "./StorageUsageMeter.module.css": { default: { meter: "meter", "is-warning": "is-warning", label: "label", track: "track", fill: "fill" } }
  };
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  return exports.StorageUsageMeter();
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return [node.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
}

test("StorageUsageMeter: 보통 상태는 문구와 접근 가능한 진행 막대를 그린다", () => {
  const tree = renderMeter({ data: { used_bytes: 1.2 * GB, limit_bytes: 5 * GB }, isError: false });
  assert.equal(tree.props.className, "meter");
  assert.equal(find(tree, (node) => node.type === "p").props.children, "내 저장 공간 1.2GB / 5GB 사용");
  const bar = find(tree, (node) => node.props?.role === "progressbar");
  assert.equal(bar.props["aria-valuenow"], 24);
  assert.equal(bar.props["aria-valuemin"], 0);
  assert.equal(bar.props["aria-valuemax"], 100);
  assert.equal(bar.props["aria-labelledby"], find(tree, (node) => node.type === "p").props.id);
});

test("StorageUsageMeter: 90% 이상이면 경고 class를 붙인다", () => {
  const tree = renderMeter({ data: { used_bytes: 4.6 * GB, limit_bytes: 5 * GB }, isError: false });
  assert.equal(tree.props.className, "meter is-warning");
  assert.equal(find(tree, (node) => node.props?.role === "progressbar").props["aria-valuenow"], 92);
});

test("StorageUsageMeter: 한도가 없으면(null) 막대 없이 사용량만 보인다", () => {
  const tree = renderMeter({ data: { used_bytes: 300 * MB, limit_bytes: null }, isError: false });
  assert.equal(find(tree, (node) => node.type === "p").props.children, "내 저장 공간 300MB 사용");
  assert.equal(find(tree, (node) => node.props?.role === "progressbar"), undefined);
});

test("StorageUsageMeter: 조회 실패·불러오는 중에는 아무것도 그리지 않는다", () => {
  assert.equal(renderMeter({ data: undefined, isError: true }), null);
  assert.equal(renderMeter({ data: { used_bytes: 1, limit_bytes: 5 * GB }, isError: true }), null);
  assert.equal(renderMeter({ data: undefined, isError: false }), null);
});

test("mock storage는 사용자 단위로 모든 워크스페이스 합계를 주고 MOCK_STORAGE_LIMIT_BYTES=none이면 한도가 없다", async (t) => {
  const { state } = await import("../mock/state.mjs");
  const { storageOf, uploadRejection } = await import("../mock/lib/limits.mjs");
  const snapshot = { workspaces: state.workspaces, documents: state.documents, assets: state.assets };
  t.after(() => Object.assign(state, snapshot));
  const original = process.env.MOCK_STORAGE_LIMIT_BYTES;
  t.after(() => { if (original === undefined) delete process.env.MOCK_STORAGE_LIMIT_BYTES; else process.env.MOCK_STORAGE_LIMIT_BYTES = original; });
  delete process.env.MOCK_STORAGE_LIMIT_BYTES;
  Object.assign(state, {
    workspaces: [{ id: "ws_a" }, { id: "ws_b" }, { id: "ws_gone", deleted_at: "x" }],
    documents: [
      { workspace_id: "ws_a", owner_user_id: "u1", byte_size: 100 },
      { workspace_id: "ws_b", owner_user_id: "u1", byte_size: 50 },
      { workspace_id: "ws_b", owner_user_id: "u1", byte_size: 999, deleted_at: "x" },
      { workspace_id: "ws_gone", owner_user_id: "u1", byte_size: 999 },
      { workspace_id: "ws_a", owner_user_id: "u2", byte_size: 7 }
    ],
    assets: [{ workspace_id: "ws_a", owner_user_id: "u1", buffer: { length: 25 } }]
  });
  assert.deepEqual(storageOf("u1"), { used_bytes: 175, limit_bytes: 5 * GB, scope: "user" });
  assert.equal(uploadRejection("u1", 5 * GB)?.code, "STORAGE_QUOTA_EXCEEDED");
  process.env.MOCK_STORAGE_LIMIT_BYTES = "none";
  assert.deepEqual(storageOf("u1"), { used_bytes: 175, limit_bytes: null, scope: "user" });
  assert.equal(uploadRejection("u1", 50 * GB), null);
});
