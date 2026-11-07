import type { Locale } from "../locale";
import koAgentChat from "./ko/agentChat.json";
import koAuth from "./ko/auth.json";
import koCommon from "./ko/common.json";
import koInvitation from "./ko/invitation.json";
import koLanding from "./ko/landing.json";
import koLegal from "./ko/legal.json";
import koMetadata from "./ko/metadata.json";
import koSettings from "./ko/settings.json";
import enAgentChat from "./en/agentChat.json";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enInvitation from "./en/invitation.json";
import enLanding from "./en/landing.json";
import enLegal from "./en/legal.json";
import enMetadata from "./en/metadata.json";
import enSettings from "./en/settings.json";

/**
 * 화면 문구. 기능 영역별 네임스페이스 JSON을 언어마다 같은 키로 둔다(키 일치는 tests/i18nMessages.test.mjs가 확인).
 * 새 네임스페이스는 ko·en 파일을 함께 만들고 아래 두 객체에 같은 이름으로 더한다. 규칙은 docs/i18n.md 참고.
 */
const ko = {
  common: koCommon,
  metadata: koMetadata,
  landing: koLanding,
  auth: koAuth,
  invitation: koInvitation,
  settings: koSettings,
  legal: koLegal,
  agentChat: koAgentChat
};

export type AppMessages = typeof ko;

export const MESSAGES: Readonly<Record<Locale, AppMessages>> = {
  ko,
  en: {
    common: enCommon,
    metadata: enMetadata,
    landing: enLanding,
    auth: enAuth,
    invitation: enInvitation,
    settings: enSettings,
    legal: enLegal,
    agentChat: enAgentChat
  }
};
