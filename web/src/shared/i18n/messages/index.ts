import type { Locale } from "../locale";
import koAuth from "./ko/auth.json";
import koCommon from "./ko/common.json";
import koDocuments from "./ko/documents.json";
import koInvitation from "./ko/invitation.json";
import koLanding from "./ko/landing.json";
import koLegal from "./ko/legal.json";
import koMeeting from "./ko/meeting.json";
import koMetadata from "./ko/metadata.json";
import koNotionImport from "./ko/notionImport.json";
import koSettings from "./ko/settings.json";
import koSkills from "./ko/skills.json";
import koWiki from "./ko/wiki.json";
import koWorkspace from "./ko/workspace.json";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enDocuments from "./en/documents.json";
import enInvitation from "./en/invitation.json";
import enLanding from "./en/landing.json";
import enLegal from "./en/legal.json";
import enMeeting from "./en/meeting.json";
import enMetadata from "./en/metadata.json";
import enNotionImport from "./en/notionImport.json";
import enSettings from "./en/settings.json";
import enSkills from "./en/skills.json";
import enWiki from "./en/wiki.json";
import enWorkspace from "./en/workspace.json";

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
  skills: koSkills,
  meeting: koMeeting,
  notionImport: koNotionImport,
  wiki: koWiki,
  workspace: koWorkspace,
  documents: koDocuments
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
    skills: enSkills,
    meeting: enMeeting,
    notionImport: enNotionImport,
    wiki: enWiki,
    workspace: enWorkspace,
    documents: enDocuments
  }
};
