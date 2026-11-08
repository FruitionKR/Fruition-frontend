import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { translator } from "./helpers/i18nMessages.mjs";

// 실제 JSX의 접근성 이름 식을 실행해 번역·동적 표시 문자열의 포함 여부를 확인한다.
function labelExpression(file, className) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties;
      const classes = attributes.find((attr) => attr.name?.getText(ast) === "className");
      if (classes?.getText(ast).includes(`"${className}"`)) {
        const label = attributes.find((attr) => attr.name?.getText(ast) === "aria-label");
        if (label?.initializer && ts.isJsxExpression(label.initializer)) expression = label.initializer.expression.getText(ast);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `${className} 접근성 이름`);
  return (context) => vm.runInNewContext(expression, context);
}

for (const locale of ["ko", "en"]) {
  test(`${locale}: 모델 버튼 이름은 현재 모델·웹 검색 표시로 시작하고 선택 기능을 유지한다`, () => {
    const t = translator(locale, "agentChat");
    const label = labelExpression("features/agent-chat/ui/AgentComposer.tsx", "composer-model-trigger");
    for (const selectedModel of [{ display_name: "GPT-6 Luna" }, { display_name: "다른 모델" }, null]) {
      for (const allowWebSearch of [false, true]) {
        const emptyModelLabel = t("composer.model.loading");
        const visible = (selectedModel?.display_name ?? emptyModelLabel) + (selectedModel && allowWebSearch ? ` ${t("composer.webSearch.label")}` : "");
        const name = label({ t, selectedModel, allowWebSearch, emptyModelLabel });
        assert.ok(name.startsWith(visible), `${visible} / ${name}`);
        assert.ok(name.includes(t("composer.model.select")));
      }
    }
  });

  test(`${locale}: PDF 변환 링크 이름은 배지 라벨로 시작하고 대상 설명을 유지한다`, () => {
    const t = translator(locale, "documents.tree.conversion");
    const label = labelExpression("widgets/document-sidebar/ui/TreeNode.tsx", "tree-conversion-link");
    for (const kind of ["source", "converted"]) {
      const conversionLabel = t(`label.${kind}`);
      const conversionDescription = t(`description.${kind === "source" ? "source" : "convertedFrom"}`, { filename: "자료.pdf" });
      const name = label({ conversionLabel, conversionDescription });
      assert.ok(name.startsWith(conversionLabel), name);
      assert.ok(name.includes(conversionDescription));
    }
  });

  test(`${locale}: 스킬 검색 해제 버튼은 화면의 검색어를 이름에 포함한다`, () => {
    const t = translator(locale, "skills");
    const label = labelExpression("widgets/skills-view/ui/SkillsView.tsx", "search-chip");
    for (const searchText of ["회의록", "project summary"]) {
      const name = label({ t, searchText });
      assert.ok(name.startsWith(t("view.searchChip", { query: searchText })), name);
      assert.ok(name.includes(t("view.clearSearch")));
    }
  });
}

test("워크스페이스 이니셜과 이미지는 장식으로 보조기술에서 제외한다", () => {
  const source = readFileSync(new URL("../src/entities/workspace/ui/WorkspaceIcon.tsx", import.meta.url), "utf8");
  assert.match(source, /return <span[^>]*aria-hidden/);
  assert.match(source, /<img[^>]*alt=""/);
});
