import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const {
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  isLegalVersion,
  listLegalVersions,
  previousLegalVersion,
  resolveLegalVersion
} = await import("../src/entities/legal/model/legalDocuments.ts");

const FILES = ["2026-10-01.md", "2027-01-15.md", "2027-01-15.changes.md", "README.md", "2026-12-01.changes.md"];

test("본문 .md만 버전으로 세고 시행일 내림차순으로 정렬한다", () => {
  assert.deepEqual(listLegalVersions(FILES), [
    { effectiveDate: "2027-01-15", hasChanges: true },
    { effectiveDate: "2026-10-01", hasChanges: false }
  ]);
});

test("본문 없이 비교표만 있는 시행일은 버전 목록에 넣지 않는다", () => {
  assert.ok(!listLegalVersions(FILES).some((version) => version.effectiveDate === "2026-12-01"));
});

test("요청 버전이 없거나 형식이 틀리거나 목록에 없으면 최신 버전으로 돌아간다", () => {
  const versions = listLegalVersions(FILES);
  assert.equal(resolveLegalVersion(versions, undefined)?.effectiveDate, "2027-01-15");
  assert.equal(resolveLegalVersion(versions, "../../etc/passwd")?.effectiveDate, "2027-01-15");
  assert.equal(resolveLegalVersion(versions, "2020-01-01")?.effectiveDate, "2027-01-15");
  assert.equal(resolveLegalVersion(versions, "2026-10-01")?.effectiveDate, "2026-10-01");
  assert.equal(resolveLegalVersion([], "2026-10-01"), null);
});

test("시행일 형식만 버전으로 인정한다", () => {
  assert.ok(isLegalVersion("2026-10-01"));
  assert.ok(!isLegalVersion("2026-10-01.md"));
  assert.ok(!isLegalVersion("2026/10/01"));
  assert.ok(!isLegalVersion(20261001));
});

test("비교표의 변경 전 버전은 바로 이전 시행일이고, 가장 오래된 버전은 없다", () => {
  const versions = listLegalVersions(FILES);
  assert.equal(previousLegalVersion(versions, versions[0])?.effectiveDate, "2026-10-01");
  assert.equal(previousLegalVersion(versions, versions[1]), null);
});

test("현재 버전 상수는 content/legal의 최신 본문 파일과 같다(access LEGAL_TERMS_VERSION 기본값 2026-10-01)", () => {
  const terms = listLegalVersions(readdirSync(new URL("../content/legal/terms", import.meta.url)));
  const privacy = listLegalVersions(readdirSync(new URL("../content/legal/privacy", import.meta.url)));
  assert.equal(terms[0]?.effectiveDate, LEGAL_TERMS_VERSION);
  assert.equal(privacy[0]?.effectiveDate, LEGAL_PRIVACY_VERSION);
});
