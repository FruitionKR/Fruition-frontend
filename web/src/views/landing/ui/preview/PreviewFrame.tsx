import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import styles from "./Preview.module.css";

/**
 * 실제 앱 화면 조각을 원래 크기(width×height)로 그린 뒤 컨테이너 폭에 맞춰 통째로 줄인다.
 * 비율은 CSS만으로 계산하므로(컨테이너 쿼리) 스크립트 없이 첫 화면부터 크기가 맞고 레이아웃이 흔들리지 않는다.
 * width·height를 생략하면 className 쪽 CSS가 --preview-w·--preview-h를 정한다(폭마다 다른 크롭이 필요할 때).
 * 장식용 미리보기라 스크린리더와 키보드 포커스에서 뺀다(inert).
 */
export function PreviewFrame({
  width,
  height,
  className,
  children
}: {
  width?: number;
  height?: number;
  className?: string;
  children: ReactNode;
}) {
  const size = width && height ? ({ "--preview-w": width, "--preview-h": height } as CSSProperties) : undefined;
  return (
    <div className={cx(styles["frame"], className)} style={size} aria-hidden="true" inert>
      <div className={styles["canvas"]}>{children}</div>
    </div>
  );
}
