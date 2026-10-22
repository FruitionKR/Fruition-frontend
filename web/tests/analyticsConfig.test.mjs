import assert from "node:assert/strict";
import test from "node:test";
import { publicAnalyticsToken } from "../src/shared/lib/analytics/config.ts";

test("브라우저에는 명시적으로 활성화한 공개 수집 키만 노출한다", () => {
  const key = "phc_public-test_fixture";
  assert.equal(publicAnalyticsToken("true", key), key);
  for (const disabled of [undefined, "", "false", "TRUE"]) {
    assert.equal(publicAnalyticsToken(disabled, key), "");
  }
  for (const invalid of [undefined, "", "phx_private_fixture", "phc_", ` ${key}`, `${key}\n`, `${key}\r\n`, `${key}?secret=private`]) {
    assert.equal(publicAnalyticsToken("true", invalid), "");
  }
});
