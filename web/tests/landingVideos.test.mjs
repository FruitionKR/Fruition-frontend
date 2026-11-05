import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const { LANDING_VIDEOS, isVideoPlayAborted, shouldPlayVideo, videoControlState } = await import("../src/views/landing/model/landingVideos.ts");
const { LANDING_DEMO_SLOTS } = await import("../src/views/landing/model/landingContent.ts");

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const publicFile = (path) => new URL(path.replace(/^\//, ""), PUBLIC_DIR);
const AUTO = { isInView: true, reduceMotion: false, choice: "auto", isBlocked: false };

test("시연 흐름은 세 묶음에 영상 8개를 한 번씩 배치한다", () => {
  assert.deepEqual(
    LANDING_DEMO_SLOTS.map((slot) => [slot.index, slot.id, slot.steps.map((step) => step.videoId)]),
    [
      ["01", "upload", ["pdf-upload", "document-editor"]],
      ["02", "connect-ask", ["wiki-ingest", "wiki-lint", "query"]],
      ["03", "edit-skill", ["ai-edit", "skill-create", "skill-run"]]
    ]
  );
  const placed = LANDING_DEMO_SLOTS.flatMap((slot) => slot.steps.map((step) => step.videoId)).sort();
  assert.deepEqual(placed, Object.keys(LANDING_VIDEOS).sort());
  for (const step of LANDING_DEMO_SLOTS.flatMap((slot) => slot.steps)) {
    assert.ok(step.title.length > 0, `${step.videoId} 제목`);
    assert.ok(step.body.length > 0, `${step.videoId} 설명`);
  }
});

test("영상과 포스터는 public/landing의 ASCII 파일명이고 실제 파일이 있다", () => {
  for (const [id, video] of Object.entries(LANDING_VIDEOS)) {
    assert.match(video.src, /^\/landing\/[a-z0-9-]+\.mp4$/, id);
    assert.match(video.poster, /^\/landing\/[a-z0-9-]+\.webp$/, id);
    assert.ok(existsSync(publicFile(video.src)), `${id} 영상`);
    assert.ok(statSync(publicFile(video.poster)).size > 0, `${id} 포스터`);
    assert.ok(video.label.length > 0, `${id} 설명`);
  }
});

test("영상 크기는 레이아웃 예약에 쓰이므로 mp4 헤더의 실제 크기와 같다", () => {
  for (const [id, video] of Object.entries(LANDING_VIDEOS)) {
    const bytes = readFileSync(publicFile(video.src));
    // tkhd 박스의 끝 8바이트가 16.16 고정소수점 폭·높이다. +faststart라 moov가 앞쪽에 있다.
    const tkhd = bytes.indexOf("tkhd", 0, "latin1");
    assert.ok(tkhd > 0, `${id} tkhd`);
    const version = bytes[tkhd + 4];
    const sizeOffset = tkhd + 4 + (version === 1 ? 88 : 76);
    assert.equal(bytes.readUInt16BE(sizeOffset), video.width, `${id} 폭`);
    assert.equal(bytes.readUInt16BE(sizeOffset + 4), video.height, `${id} 높이`);
    assert.ok(tkhd < 4096, `${id}는 앞부분에 moov가 있어야 받으면서 재생된다`);
  }
});

test("화면에 들어오면 재생하고 나가면 멈춘다", () => {
  assert.equal(shouldPlayVideo(AUTO), true);
  assert.equal(shouldPlayVideo({ ...AUTO, isInView: false }), false);
  assert.equal(shouldPlayVideo({ ...AUTO, isInView: false, choice: "playing" }), false);
});

test("움직임 줄이기에서는 자동 재생하지 않고, 사용자가 누르면 재생한다", () => {
  assert.equal(shouldPlayVideo({ ...AUTO, reduceMotion: true }), false);
  assert.equal(shouldPlayVideo({ ...AUTO, reduceMotion: true, choice: "playing" }), true);
});

test("브라우저가 재생을 거부하면 다시 시도하지 않고, 사용자가 누르면 재생한다", () => {
  assert.equal(shouldPlayVideo({ ...AUTO, isBlocked: true }), false);
  assert.equal(shouldPlayVideo({ ...AUTO, isBlocked: true, choice: "playing" }), true);
});

test("사용자가 멈춘 영상은 화면에 다시 들어와도 재생하지 않는다", () => {
  assert.equal(shouldPlayVideo({ ...AUTO, choice: "paused" }), false);
});

test("pause로 끊긴 play는 재생 거부로 치지 않는다", () => {
  assert.equal(isVideoPlayAborted({ name: "AbortError" }), true);
  assert.equal(isVideoPlayAborted({ name: "NotAllowedError" }), false);
  assert.equal(isVideoPlayAborted(new Error("x")), false);
});

test("버튼은 재생하려는 동안 일시정지이고, 실패하면 숨긴다", () => {
  assert.equal(videoControlState({ wantsPlay: true, hasFailed: false }), "pause");
  assert.equal(videoControlState({ wantsPlay: false, hasFailed: false }), "play");
  assert.equal(videoControlState({ wantsPlay: false, hasFailed: true }), "hidden");
});
