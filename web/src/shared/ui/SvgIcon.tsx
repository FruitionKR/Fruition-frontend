import type { StaticImageData } from "next/image";
import Image from "next/image";
import { cx } from "@/shared/lib/classNames";
import type { SvgAsset } from "./icons/assets";
import { inlineIconRenderers } from "./icons/inlineIcons";

export * from "./icons/assets";

export function SvgIcon({ src, className }: { src: SvgAsset; className?: string }) {
  // className을 넘겨도 .svg-icon의 object-fit/flex 기본 동작은 유지한다
  const iconClassName = cx("svg-icon", className ?? "svg-icon-fill");
  const renderInline = inlineIconRenderers.get(src);

  if (renderInline) return renderInline(iconClassName);

  // 인라인 렌더러가 없는 자산은 항상 정적 이미지다
  return <Image alt="" aria-hidden className={iconClassName} src={src as StaticImageData} />;
}
