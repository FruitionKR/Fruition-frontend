import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const wiki = await import("../src/features/mcp-approval/lib/wikiDraftPreview.ts");
const run = await import("../src/features/mcp-approval/lib/mcpApproval.ts");
const messages = Object.fromEntries(["ko", "en"].map((locale) => [
  locale, JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/mcpApproval.json`, import.meta.url), "utf8"))
]));

const STAGES = ["awaiting", "executing", "published", "noChange", "conflicted", "halted", "unknown", "rejected", "invalidated", "other"];

test("every status value the parsers accept has a human label in ko and en, plus a neutral fallback", () => {
  const groups = {
    kind: wiki.MCP_WIKI_DRAFT_KINDS,
    approval: wiki.MCP_WIKI_APPROVAL_STATUSES,
    publication: wiki.MCP_WIKI_PUBLICATION_STATUSES,
    settlement: wiki.MCP_WIKI_SETTLEMENT_STATUSES,
    pricingModel: wiki.MCP_WIKI_PRICING_MODELS
  };
  for (const [locale, bundle] of Object.entries(messages)) {
    for (const [group, values] of Object.entries(groups)) {
      for (const value of [...values, "OTHER"]) {
        const label = bundle.wiki.labels[group][value];
        assert.ok(typeof label === "string" && label.trim(), `${locale} wiki.labels.${group}.${value}`);
        assert.notEqual(label, value, `${locale} ${group}.${value} is not the raw code`);
      }
    }
    for (const stage of STAGES) assert.ok(bundle.wiki.stage[stage]?.trim(), `${locale} wiki.stage.${stage}`);
    for (const kind of [...wiki.MCP_WIKI_DRAFT_KINDS, "OTHER"]) {
      assert.ok(bundle.wiki.headline[kind] && bundle.wiki.headlineNoTopic[kind], `${locale} wiki headline ${kind}`);
    }
    for (const [group, values] of [["execution", run.MCP_EXECUTION_STATUSES], ["forward", run.MCP_FORWARD_STATUSES], ["settlementStatus", run.MCP_SETTLEMENT_STATUSES]]) {
      for (const value of [...values, "OTHER"]) assert.ok(bundle[group][value]?.trim(), `${locale} ${group}.${value}`);
    }
    for (const kind of ["editDocuments", "createDocuments", "publishSkill", "operations", "unknown"]) assert.ok(bundle.headline[kind], `${locale} headline.${kind}`);
    for (const kind of ["free", "maximum", "reserved", "reconciling", "charged"]) assert.ok(bundle.cost[kind], `${locale} cost.${kind}`);
    for (const kind of ["maximum", "reserved", "reconciling", "charged", "adjusted", "released"]) assert.ok(bundle.wiki.cost[kind], `${locale} wiki.cost.${kind}`);
  }
});

test("unknown codes fall back to OTHER instead of showing a missing translation", () => {
  assert.equal(wiki.mcpKnownCode(wiki.MCP_WIKI_PUBLICATION_STATUSES, "PUBLISHED"), "PUBLISHED");
  assert.equal(wiki.mcpKnownCode(wiki.MCP_WIKI_PUBLICATION_STATUSES, "SOMETHING_NEW"), "OTHER");
});

const state = (approval, publication) => wiki.mcpWikiDraftStage({ approval: { status: approval, reason: null }, publication: { status: publication } });

test("draft stage reads publication first once approved, approval otherwise", () => {
  assert.deepEqual(state("AWAITING", "NOT_STARTED"), { stage: "awaiting", tone: "pending" });
  assert.deepEqual(state("EXECUTING", "NOT_STARTED"), { stage: "executing", tone: "progress" });
  assert.deepEqual(state("EXECUTING", "APPLYING"), { stage: "executing", tone: "progress" });
  assert.deepEqual(state("EXECUTING", "PUBLISHED"), { stage: "published", tone: "success" });
  assert.deepEqual(state("EXECUTING", "NO_CHANGE"), { stage: "noChange", tone: "neutral" });
  assert.deepEqual(state("EXECUTING", "CONFLICTED"), { stage: "conflicted", tone: "danger" });
  assert.deepEqual(state("EXECUTING", "HALTED"), { stage: "halted", tone: "warning" });
  assert.deepEqual(state("EXECUTING", "UNKNOWN"), { stage: "unknown", tone: "warning" });
  assert.deepEqual(state("REJECTED", "NOT_STARTED"), { stage: "rejected", tone: "neutral" });
  assert.deepEqual(state("INVALIDATED", "NOT_STARTED"), { stage: "invalidated", tone: "warning" });
  assert.deepEqual(state("NEW_STATUS", "NOT_STARTED"), { stage: "other", tone: "neutral" });
});

test("wiki cost line follows the settlement", () => {
  const cost = (approval, settlement, charged = 0) => wiki.mcpWikiCostLine({
    approval: { status: approval, reason: null }, quote: { maximum_charge_minor: 300 }, settlement: { status: settlement, charged_minor: charged }
  });
  assert.deepEqual(cost("AWAITING", "NOT_RESERVED"), { kind: "maximum", amount: 300 });
  assert.deepEqual(cost("EXECUTING", "RESERVED"), { kind: "reserved", amount: 300 });
  assert.deepEqual(cost("EXECUTING", "PENDING_RECONCILIATION"), { kind: "reconciling", amount: 300 });
  assert.deepEqual(cost("EXECUTING", "SETTLED", 200), { kind: "charged", amount: 200 });
  assert.deepEqual(cost("EXECUTING", "ADJUSTED", 100), { kind: "adjusted", amount: 100 });
  assert.deepEqual(cost("EXECUTING", "RELEASED"), { kind: "released" });
  assert.deepEqual(cost("REJECTED", "NOT_RESERVED"), { kind: "released" });
  assert.deepEqual(cost("INVALIDATED", "NOT_RESERVED"), { kind: "released" });
});

test("wiki headline topic is the first concept and counts the rest", () => {
  const item = (page_title) => ({ kind: "STATEMENT_ADD", page_id: null, page_title, text: "t", before_text: null, related_page_title: null, evidence: [] });
  assert.equal(wiki.mcpWikiHeadlineTopic([]), null);
  assert.deepEqual(wiki.mcpWikiHeadlineTopic([item("A"), item("B"), item("A"), item("C")]), { topic: "A", others: 2 });
});

test("run headline, tone and cost line", () => {
  const ops = (...tools) => ({ operations: tools.map((tool_name) => ({ tool_name })) });
  assert.deepEqual(run.mcpRunHeadline(ops("apply_document_edit", "apply_document_edit")), { kind: "editDocuments", count: 2 });
  assert.deepEqual(run.mcpRunHeadline(ops("create_document")), { kind: "createDocuments", count: 1 });
  assert.deepEqual(run.mcpRunHeadline(ops("publish_skill_definition")), { kind: "publishSkill", count: 1 });
  assert.deepEqual(run.mcpRunHeadline(ops("create_folder", "move_document")), { kind: "operations", count: 2 });
  assert.deepEqual(run.mcpRunHeadline(null), { kind: "unknown", count: 0 });
  assert.equal(run.mcpRunTone("awaiting_approval"), "pending");
  assert.equal(run.mcpRunTone("completed"), "success");
  assert.equal(run.mcpRunTone("failed"), "danger");
  assert.equal(run.mcpRunTone("brand_new"), "neutral");
  assert.deepEqual(run.mcpRunCostLine(null, { maximum_charge_minor: 0 }), { kind: "free" });
  assert.deepEqual(run.mcpRunCostLine(null, { maximum_charge_minor: 30 }), { kind: "maximum", amount: 30 });
  assert.equal(run.mcpRunCostLine(null, null), null);
  const settlement = (settlement_status) => ({ settlement_status, charged_minor: 20, maximum_charge_minor: 30 });
  assert.deepEqual(run.mcpRunCostLine(settlement("SETTLED"), null), { kind: "charged", amount: 20 });
  assert.deepEqual(run.mcpRunCostLine(settlement("PENDING_RECONCILIATION"), null), { kind: "reconciling", amount: 30 });
  assert.deepEqual(run.mcpRunCostLine(settlement("RESERVED"), null), { kind: "reserved", amount: 30 });
});
