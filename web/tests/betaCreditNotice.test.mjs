import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("베타 알림은 계정별로 한 번 표시하며 지급 중에만 폴링한다", () => {
  const code = ts.transpileModule(readFileSync(new URL("../src/features/document-notifications/model/useBetaCreditNotice.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  let user = { id: "one" };
  let data = { status: "pending", amount_krw_milli: null };
  let options;
  const notices = [];
  const storage = new Map();
  const ref = { current: new Set() };
  const exports = {};
  runInNewContext(code, {
    exports,
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    require: (name) => ({
      react: { useEffect: (fn) => fn(), useRef: () => ref },
      "@tanstack/react-query": { useQuery: (value) => { options = value; return { data }; } },
      "next-intl": { useTranslations: () => (key) => key },
      "@/entities/user": { useMe: () => ({ data: user }), fetchBetaCredit: () => {} },
      "./noticeBus": { publishNotice: (notice) => notices.push(notice) }
    })[name]
  });
  const render = exports.useBetaCreditNotice;
  render(); render();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "pending.title");
  assert.equal(options.refetchInterval({ state: { data } }), 5000);
  data = { status: "granted", amount_krw_milli: 7000000 };
  render(); render();
  assert.equal(notices.length, 2);
  assert.equal(notices[1].title, "granted.title");
  assert.equal(options.refetchInterval({ state: { data } }), false);
  ref.current.clear(); render();
  assert.equal(notices.length, 2);
  user = { id: "two" }; data = { status: "exhausted", amount_krw_milli: null }; render();
  assert.equal(notices[2].title, "exhausted.title");
  data = { status: "ineligible", amount_krw_milli: null }; render();
  assert.equal(notices.length, 3);
  user = undefined; render();
  assert.equal(options.enabled, false);
  assert.equal(options.refetchInterval({ state: {} }), 5000);
});
