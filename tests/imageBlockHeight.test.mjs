import assert from "node:assert/strict";
import test from "node:test";

const { computeImageBlockHeight, recoverImageBlockRatio, refitImageBlocks } = await import("../src/features/note-editing/model/imageBlockHeight.ts");

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

test("저장된 ratio는 data-height/data-origin에서 그대로 되살아난다", () => {
  for (const ratio of [0.5, 1, 1.37, 2.25]) {
    for (const origin of [1, 37.5, 400, 1234.56]) {
      const height = Number((origin * ratio).toFixed(2));
      assert.equal(recoverImageBlockRatio(height, origin), ratio, `origin ${origin}, ratio ${ratio}`);
    }
  }
});

test("ratio를 되살려 폭을 바꿔 다시 계산해도 ratio가 유지된다", () => {
  const before = computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 900, ratio: 0.5 });
  const ratio = recoverImageBlockRatio(Number(before.height), Number(before.origin));
  const after = computeImageBlockHeight({ naturalWidth: 2000, naturalHeight: 1000, hostWidth: 600, ratio });
  assert.equal(ratio, 0.5);
  assert.deepEqual(after, { origin: "300.00", height: "150.00" });
  assert.equal(recoverImageBlockRatio(Number(after.height), Number(after.origin)), 0.5);
});

test("origin이 없으면 ratio를 되살리지 않는다", () => {
  assert.equal(recoverImageBlockRatio(100, 0), null);
  assert.equal(recoverImageBlockRatio(100, Number.NaN), null);
});

/** querySelectorAll·closest·getBoundingClientRect만 흉내 낸 최소 DOM. */
function fakeEditor(hostWidth, images) {
  const host = { getBoundingClientRect: () => ({ width: hostWidth }) };
  const elements = images.map((image) => {
    let heightWrites = 0;
    const style = {};
    Object.defineProperty(style, "height", {
      get: () => image.styleHeight,
      set: (value) => {
        heightWrites += 1;
        image.styleHeight = value;
      }
    });
    return {
      complete: image.complete ?? true,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      dataset: { ...image.dataset },
      style,
      closest: () => host,
      get heightWrites() {
        return heightWrites;
      }
    };
  });
  return { root: { querySelectorAll: () => elements }, host, elements };
}

test("refit은 되살린 ratio로 새 폭의 높이를 쓴다", () => {
  const { root, elements } = fakeEditor(600, [
    { naturalWidth: 2000, naturalHeight: 1000, dataset: { origin: "450.00", height: "225.00" } }
  ]);
  refitImageBlocks(root);
  assert.deepEqual(elements[0].dataset, { origin: "300.00", height: "150.00" });
  assert.equal(elements[0].style.height, "150.00px");
});

test("refit은 값이 같으면 DOM을 바꾸지 않는다", () => {
  const { root, elements } = fakeEditor(600, [
    { naturalWidth: 2000, naturalHeight: 1000, dataset: { origin: "300.00", height: "150.00" } }
  ]);
  refitImageBlocks(root);
  assert.equal(elements[0].heightWrites, 0);
});

test("폭 0일 때 로드돼 data-origin이 없는 이미지는 노드 ratio로 처음 계산한다", () => {
  const { root, host, elements } = fakeEditor(600, [{ naturalWidth: 2000, naturalHeight: 1000, dataset: {} }]);
  const asked = [];
  refitImageBlocks(root, (target) => {
    asked.push(target);
    return 0.5;
  });
  assert.deepEqual(asked, [host]);
  assert.deepEqual(elements[0].dataset, { origin: "300.00", height: "150.00" });
  assert.equal(elements[0].style.height, "150.00px");
});

test("노드 ratio를 읽지 못하면 1로 계산한다", () => {
  const { root, elements } = fakeEditor(600, [{ naturalWidth: 2000, naturalHeight: 1000, dataset: {} }]);
  refitImageBlocks(root, () => undefined);
  assert.deepEqual(elements[0].dataset, { origin: "300.00", height: "300.00" });
});

test("노드 ratio가 유효한 양수가 아니면 1로 계산해 data-origin이 깨지지 않는다", () => {
  for (const invalid of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
    const { root, elements } = fakeEditor(600, [{ naturalWidth: 2000, naturalHeight: 1000, dataset: {} }]);
    refitImageBlocks(root, () => invalid);
    assert.deepEqual(elements[0].dataset, { origin: "300.00", height: "300.00" }, String(invalid));
  }
});

test("로드 전 이미지, 깨진 이미지, 폭 0인 호스트는 건너뛴다", () => {
  const pending = fakeEditor(600, [{ complete: false, naturalWidth: 0, naturalHeight: 0, dataset: {} }]);
  const broken = fakeEditor(600, [{ naturalWidth: 0, naturalHeight: 0, dataset: {} }]);
  const hidden = fakeEditor(0, [{ naturalWidth: 2000, naturalHeight: 1000, dataset: {} }]);
  for (const { root, elements } of [pending, broken, hidden]) {
    refitImageBlocks(root);
    assert.deepEqual(elements[0].dataset, {});
    assert.equal(elements[0].heightWrites, 0);
  }
});
