"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useUserPreferences } from "@/entities/user";
import {
  isVideoPlayAborted,
  shouldPlayVideo,
  videoControlState,
  type LandingVideo as LandingVideoAsset,
  type VideoChoice
} from "../model/landingVideos";
import styles from "./LandingSections.module.css";

// 절반 이상 보이는 영상만 재생해 한 화면에서 여러 개가 동시에 움직이는 일을 줄인다.
const IN_VIEW_THRESHOLD = 0.5;

/**
 * 소리 없는 시연 영상. 화면에 들어올 때 처음 파일을 받고, 화면 밖에서는 멈춘다.
 * 첫 프레임이 나오기 전이나 재생이 거부·실패한 동안에는 뒤에 깔린 포스터가 보인다.
 */
export function LandingVideo({ video }: { video: LandingVideoAsset }) {
  const { reduceMotion } = useUserPreferences();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [choice, setChoice] = useState<VideoChoice>("auto");
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [hasSource, setHasSource] = useState(false);
  const [hasPosterFailed, setHasPosterFailed] = useState(false);

  const wantsPlay = !hasFailed && shouldPlayVideo({ isInView, reduceMotion, choice, isBlocked });
  if (wantsPlay && !hasSource) setHasSource(true);
  const control = videoControlState({ wantsPlay, hasFailed });

  // 서버가 그린 포스터는 하이드레이션 전에 실패할 수 있어 onError만으로는 놓친다.
  useEffect(() => {
    const poster = posterRef.current;
    if (poster?.complete && poster.naturalWidth === 0) setHasPosterFailed(true);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver(
      (entries) => setIsInView(entries[entries.length - 1].intersectionRatio >= IN_VIEW_THRESHOLD),
      { threshold: IN_VIEW_THRESHOLD }
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!wantsPlay) {
      element.pause();
      return;
    }
    element.play().catch((error: unknown) => {
      if (isVideoPlayAborted(error)) return;
      // 파일을 못 읽은 경우는 onError가 처리하고, 나머지는 사용자가 버튼을 누를 때까지 포스터를 둔다.
      setChoice("auto");
      setIsBlocked(true);
    });
  }, [wantsPlay]);

  const toggle = () => {
    if (wantsPlay) {
      setChoice("paused");
      return;
    }
    setChoice("playing");
    setIsBlocked(false);
    setIsInView(true);
  };

  return (
    <div
      ref={stageRef}
      className={styles["demo-video"]}
      style={{ "--video-ratio": `${video.width} / ${video.height}` } as CSSProperties}
    >
      {/* 포스터를 못 받아도 빈 칸이 되지 않게 뒤에 이름을 둔다. */}
      <span className={styles["demo-video-fallback"]} aria-hidden="true">
        {video.label}
      </span>
      {!hasPosterFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- 크기가 정해진 포스터이고, 영상이 덮을 때까지만 보인다
        <img
          ref={posterRef}
          className={styles["demo-video-poster"]}
          src={video.poster}
          width={video.width}
          height={video.height}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasPosterFailed(true)}
        />
      )}
      <video
        ref={videoRef}
        className={styles["demo-video-media"]}
        data-ready={hasFrame && !hasFailed}
        src={hasSource ? video.src : undefined}
        width={video.width}
        height={video.height}
        aria-label={video.label}
        autoPlay={!reduceMotion}
        muted
        playsInline
        loop
        preload="none"
        onPlaying={() => setHasFrame(true)}
        onError={() => setHasFailed(true)}
      />
      {hasFailed && (
        <p className={styles["demo-video-status"]} role="status">
          영상을 불러오지 못했습니다.
        </p>
      )}
      {control !== "hidden" && (
        <button
          type="button"
          className={styles["demo-video-toggle"]}
          data-state={control}
          aria-label={`${control === "pause" ? "일시정지" : "재생"}: ${video.label}`}
          onClick={toggle}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            {control === "pause" ? <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /> : <path d="M4.5 2.2v11.6L13.5 8z" />}
          </svg>
        </button>
      )}
    </div>
  );
}
