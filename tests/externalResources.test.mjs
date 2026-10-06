import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyImageSource,
  classifyLinkHref,
  countExternalMarkdownImages,
  isAllowedImageSource,
  isManagedAssetPath
} from "../src/shared/lib/externalResources.ts";

const MANAGED = "/api/workspaces/ws_1/assets/asset_1/content";

test("관리 경로·data:image·blob:만 요청해도 되는 이미지로 본다", () => {
  assert.deepEqual(classifyImageSource(MANAGED), { kind: "managed" });
  assert.equal(isManagedAssetPath(MANAGED), true);
  assert.deepEqual(classifyImageSource("data:image/png;base64,AAAA"), { kind: "inline" });
  assert.deepEqual(classifyImageSource("blob:http://localhost:3000/abc"), { kind: "inline" });
  for (const src of [MANAGED, "data:image/svg+xml,%3Csvg%3E", "blob:https://app.example/x"]) {
    assert.equal(isAllowedImageSource(src), true, src);
  }
});

test("다른 오리진은 표기와 관계없이 외부로 보고 host만 돌려준다", () => {
  const cases = [
    ["https://attacker.example/?q=회의 내용", "attacker.example"],
    ["http://attacker.example:8080/a.png", "attacker.example:8080"],
    ["//attacker.example/a.png", "attacker.example"],
    ["/\\attacker.example/a.png", "attacker.example"],
    ["\\\\attacker.example/a.png", "attacker.example"],
    ["  HTTPS://Attacker.Example/a.png  ", "attacker.example"],
    ["https://user:pw@attacker.example/a.png", "attacker.example"]
  ];
  for (const [src, host] of cases) {
    assert.deepEqual(classifyImageSource(src), { kind: "external", host }, src);
    assert.equal(isAllowedImageSource(src), false, src);
  }
});

test("관리 경로가 아닌 같은 출처 경로·알 수 없는 스킴·빈 값은 요청하지 않는다", () => {
  for (const src of ["", "   ", "/logo.png", "images/a.png", "/api/workspaces/ws/assets/a/content?x=1", "attachment://0c973836-6687-4018-b2c7-f2f66984e87b", "ftp://example.com/a.png", "data:text/html,<b>x</b>", "javascript:alert(1)"]) {
    assert.deepEqual(classifyImageSource(src), { kind: "unsupported" }, src);
  }
});

test("링크는 상대 경로·#·?는 내부, 다른 오리진과 mailto:는 외부로 본다", () => {
  for (const href of [undefined, "", "#heading", "?tab=1", "/workspaces/ws/documents/1", "notes/a.md"]) {
    assert.deepEqual(classifyLinkHref(href), { external: false }, String(href));
  }
  assert.deepEqual(classifyLinkHref("https://evil.example/login?next=x"), { external: true, host: "evil.example" });
  assert.deepEqual(classifyLinkHref("//evil.example"), { external: true, host: "evil.example" });
  assert.deepEqual(classifyLinkHref("mailto:a@example.com"), { external: true, host: "" });
});

test("원문 markdown의 외부 이미지 수를 인라인·참조형·HTML 표기에서 센다", () => {
  assert.equal(countExternalMarkdownImages("글만 있다 [링크](https://example.com)"), 0);
  assert.equal(countExternalMarkdownImages(`![](${MANAGED}) ![x](data:image/png;base64,AA)`), 0);
  assert.equal(countExternalMarkdownImages("![a](https://a.example/x.png) ![b]( <//b.example/y.png> \"t\")"), 2);
  assert.equal(countExternalMarkdownImages("![a][logo] ![logo][] ![Logo]\n\n[logo]: https://a.example/x.png\n[site]: https://a.example"), 3);
  assert.equal(countExternalMarkdownImages("[site][ref]\n\n[ref]: https://a.example"), 0);
  assert.equal(countExternalMarkdownImages("<img alt=x src=\"https://a.example/p.gif\"> <IMG SRC='/local.png'>"), 1);
});
