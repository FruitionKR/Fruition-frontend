import type { Locale } from "./locale";
import type { AppMessages } from "./messages";

// useTranslations·getTranslations의 키와 로케일을 타입으로 검사한다. 한국어 문구가 기준이다.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: AppMessages;
  }
}
