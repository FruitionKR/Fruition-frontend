import assert from "node:assert/strict";
import test from "node:test";

const { computeImageBlockHeight } = await import("../src/features/note-editing/model/imageBlockHeight.ts");

test("호스트보다 넓은 이미지는 호스트 폭에 맞춘 높이를 쓴다", () => {
  assert.deepEqual(
    computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 800, ratio: 1 }),
    { origin: "400.00", height: "400.00" }
  );
});

test("편집기 폭이 줄면 높이도 같은 비율로 줄어든다", () => {
  const wide = computeImageBlockHeight({ naturalWidth: 1200, naturalHeight: 900, hostWidth: 1000, ratio: 1 });
  const narrow = computeImageBlockHeight({ naturalWidth: 1200, naturalHeight: 900, hostWidth: 600, ratio: 1 });
  assert.deepEqual(wide, { origin: "750.00", height: "750.00" });
  assert.deepEqual(narrow, { origin: "450.00", height: "450.00" });
});

test("호스트보다 작은 이미지는 원래 높이를 쓴다", () => {
  assert.deepEqual(
    computeImageBlockHeight({ naturalWidth: 300, naturalHeight: 200, hostWidth: 800, ratio: 1 }),
    { origin: "200.00", height: "200.00" }
  );
});

test("사용자가 조절한 ratio를 기본 높이에 곱한다", () => {
  assert.deepEqual(
    computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 600, ratio: 0.5 }),
    { origin: "300.00", height: "150.00" }
  );
});

test("maxHeight·maxWidth 설정이 있으면 라이브러리처럼 상한을 둔다", () => {
  assert.deepEqual(
    computeImageBlockHeight({ naturalWidth: 1000, naturalHeight: 2000, hostWidth: 800, ratio: 1, maxHeight: 500 }),
    { origin: "500.00", height: "500.00" }
  );
  assert.deepEqual(
    computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 800, ratio: 1, maxWidth: 400 }),
    { origin: "200.00", height: "200.00" }
  );
});

test("이미지나 호스트 폭을 알 수 없으면 계산하지 않는다", () => {
  assert.equal(computeImageBlockHeight({ naturalWidth: 0, naturalHeight: 0, hostWidth: 800, ratio: 1 }), null);
  assert.equal(computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 0, ratio: 1 }), null);
});
