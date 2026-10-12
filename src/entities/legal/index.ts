// 서버 전용 loader(api/legalContent)는 node:fs를 쓰므로 여기서 내보내지 않는다. 서버 컴포넌트가 직접 import한다.
export {
  LEGAL_DOCUMENTS,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  OPERATOR_INFO,
  OPERATOR_INFO_PENDING,
  type LegalDocumentMeta,
  type LegalDocumentSlug,
  type LegalVersion
} from "./model/legalDocuments";
