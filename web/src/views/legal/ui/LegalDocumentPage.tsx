import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LEGAL_DOCUMENTS, type LegalDocumentSlug } from "@/entities/legal";
import { loadLegalDocument } from "@/entities/legal/api/legalContent";
import { LEGAL_PAGES_ENABLED } from "@/shared/config/legal";
import { LegalFooter } from "@/shared/ui/LegalFooter";

type LegalDocumentPageProps = {
  slug: LegalDocumentSlug;
  searchParams: Promise<{ version?: string | string[] }>;
};

/**
 * /terms, /privacy 공개 페이지(이슈 #130). 로그인·접근 코드 없이 열린다.
 * `?version=YYYY-MM-DD`로 이전 버전을 보고, 비교표 파일이 있으면 본문 아래에 함께 보인다.
 * 서버 컴포넌트라 저장소 Markdown을 요청 때 읽는다(layout이 force-dynamic).
 * NEXT_PUBLIC_LEGAL_PAGES_ENABLED가 "true"가 아니면 404로 처리한다(법률 확정본 전까지 기본 꺼짐).
 * 본문은 한국어 원문만 있어 번역하지 않는다. 한국어가 아닌 화면에서는 머리말·버전 표시만 그 언어로 쓰고 원문 안내를 붙인다.
 */
export async function LegalDocumentPage({ slug, searchParams }: LegalDocumentPageProps) {
  if (!LEGAL_PAGES_ENABLED) notFound();
  const meta = LEGAL_DOCUMENTS[slug];
  const { version: requestedVersion } = await searchParams;
  const content = await loadLegalDocument(slug, Array.isArray(requestedVersion) ? requestedVersion[0] : requestedVersion);
  if (!content) notFound();

  const isCurrent = content.version.effectiveDate === content.versions[0]?.effectiveDate;
  const [t, format, locale] = await Promise.all([getTranslations("legal"), getFormatter(), getLocale()]);
  const title = t(`documents.${slug}`);
  // 시행일은 한국 날짜다. 서버 시간대와 상관없이 그날로 보이게 서울 자정으로 읽는다.
  const formatEffectiveDate = (effectiveDate: string) =>
    format.dateTime(new Date(`${effectiveDate}T00:00:00+09:00`), { dateStyle: "long", timeZone: "Asia/Seoul" });

  return (
    <main className="legal-page">
      <article className="legal-document" aria-labelledby="legal-title">
        <header className="legal-header">
          <nav className="legal-breadcrumb" aria-label={t("page.home")}>
            <Link href="/">Fruition</Link>
          </nav>
          <h1 id="legal-title">{title}</h1>
          <p className="legal-effective">
            {t("page.effective", { date: formatEffectiveDate(content.version.effectiveDate) })}
            {!isCurrent && <strong className="legal-badge-old">{t("page.previousVersion")}</strong>}
          </p>
          {locale !== "ko" && <p className="legal-effective">{t("page.koreanOnly")}</p>}
          {content.versions.length > 1 && (
            <nav className="legal-versions" aria-label={t("page.versions")}>
              <span>{t("page.versionLabel")}</span>
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
                        {index === 0 && t("page.current")}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </header>

        {/* 본문은 한국어 원문이라 화면 언어와 상관없이 lang="ko"로 읽게 한다. */}
        <section className="legal-body" aria-label={t("page.body", { title })} lang="ko">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.markdown}</ReactMarkdown>
        </section>

        {content.changesMarkdown && (
          <section className="legal-body legal-changes" aria-labelledby="legal-changes-title">
            <h2 id="legal-changes-title">
              {t("page.changes")}
              {content.previous && <small>{content.previous.effectiveDate} → {content.version.effectiveDate}</small>}
            </h2>
            <div lang="ko">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.changesMarkdown}</ReactMarkdown>
            </div>
          </section>
        )}
      </article>
      <LegalFooter />
    </main>
  );
}
