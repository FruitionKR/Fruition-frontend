import type { Viewport } from "next";

export { default } from "@/views/home";

// 앱 화면만 노치 영역까지 쓰고(안전 영역은 CSS env로 비켜 둔다), Android 키보드가 뜨면 레이아웃 높이를 줄인다.
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content"
};
