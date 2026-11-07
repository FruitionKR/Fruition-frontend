import type { useTranslations } from "next-intl";

/** skills 네임스페이스 번역 함수. 문구를 만드는 순수 함수는 화면이 넘겨준 이 함수로 현재 언어 문구를 만든다. */
export type SkillsTranslate = ReturnType<typeof useTranslations<"skills">>;
