import Link from "next/link";
import { LEGAL_DOCUMENTS, OPERATOR_INFO, OPERATOR_INFO_PENDING } from "@/entities/legal";

/**
 * 이용약관·개인정보 처리방침 링크와 운영자 정보(이슈 #130). 로그인·가입 화면 하단(AuthScreen), 랜딩, 설정 화면 하단에 둘 예정이다.
 * 법률 확정본·운영자 정보가 나오기 전까지는 /terms·/privacy 페이지 안에서만 렌더한다(그 페이지도 기능 플래그가 꺼지면 404).
 * 운영자 정보는 사업자등록·통신판매업 신고 뒤 OPERATOR_INFO에서 채운다. 그 전까지는 "[확정 필요]"가 눈에 띄게 보인다.
 */
export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "legal-footer legal-footer--compact" : "legal-footer"} aria-label="서비스 운영 정보">
      <nav className="legal-footer-links" aria-label="약관과 정책">
        <Link href={LEGAL_DOCUMENTS.terms.path}>{LEGAL_DOCUMENTS.terms.title}</Link>
        <span aria-hidden="true" />
        <Link href={LEGAL_DOCUMENTS.privacy.path}>{LEGAL_DOCUMENTS.privacy.title}</Link>
      </nav>
      <dl className="legal-footer-operator">
        {OPERATOR_INFO.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className={item.value === OPERATOR_INFO_PENDING ? "is-pending" : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}
