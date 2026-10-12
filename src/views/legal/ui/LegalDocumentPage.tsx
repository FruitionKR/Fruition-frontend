import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LEGAL_DOCUMENTS, type LegalDocumentSlug } from "@/entities/legal";
import { loadLegalDocument } from "@/entities/legal/api/legalContent";
import { LegalFooter } from "@/shared/ui/LegalFooter";

type LegalDocumentPageProps = {
  slug: LegalDocumentSlug;
  searchParams: Promise<{ version?: string | string[] }>;
};

/**
 * /terms, /privacy 공개 페이지(이슈 #130). 로그인·접근 코드 없이 열린다.
 * `?version=YYYY-MM-DD`로 이전 버전을 보고, 비교표 파일이 있으면 본문 아래에 함께 보인다.
 * 서버 컴포넌트라 저장소 Markdown을 요청 때 읽는다(layout이 force-dynamic).
 */
export async function LegalDocumentPage({ slug, searchParams }: LegalDocumentPageProps) {
  const meta = LEGAL_DOCUMENTS[slug];
  const { version: requestedVersion } = await searchParams;
  const content = await loadLegalDocument(slug, Array.isArray(requestedVersion) ? requestedVersion[0] : requestedVersion);
  if (!content) notFound();

  const isCurrent = content.version.effectiveDate === content.versions[0]?.effectiveDate;

  return (
    <main className="legal-page">
      <article className="legal-document" aria-labelledby="legal-title">
        <header className="legal-header">
          <nav className="legal-breadcrumb" aria-label="서비스 홈">
            <Link href="/">Fruition</Link>
          </nav>
          <h1 id="legal-title">{meta.title}</h1>
          <p className="legal-effective">
            시행일 {formatEffectiveDate(content.version.effectiveDate)}
            {!isCurrent && <strong className="legal-badge-old">이전 버전</strong>}
          </p>
          {content.versions.length > 1 && (
            <nav className="legal-versions" aria-label="시행일별 버전">
              <span>버전</span>
              <ul>
                {content.versions.map((version, index) => {
                  const isSelected = version.effectiveDate === content.version.effectiveDate;
                  return (
                    <li key={version.effectiveDate}>
                      <Link
                        href={index === 0 ? meta.path : `${meta.path}?version=${version.effectiveDate}`}
                        aria-current={isSelected ? "page" : undefined}
                      >
                        {version.effectiveDate}
                        {index === 0 && " (현재)"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </header>

        <section className="legal-body" aria-label={`${meta.title} 본문`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.markdown}</ReactMarkdown>
        </section>

        {content.changesMarkdown && (
          <section className="legal-body legal-changes" aria-labelledby="legal-changes-title">
            <h2 id="legal-changes-title">
              변경 비교
              {content.previous && <small>{content.previous.effectiveDate} → {content.version.effectiveDate}</small>}
            </h2>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.changesMarkdown}</ReactMarkdown>
          </section>
        )}
      </article>
      <LegalFooter />
    </main>
  );
}

function formatEffectiveDate(effectiveDate: string): string {
  const [year, month, day] = effectiveDate.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}
