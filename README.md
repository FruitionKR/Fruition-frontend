# Fruition Frontend

Fruition의 Next.js 웹 프론트엔드입니다. 이 저장소는 화면·API 호출·UI 테스트·frontend 문서를 소유하며 Vercel에 독립 배포합니다.

## 로컬 실행

Node.js 22를 사용합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

로그인·문서·AI 기능은 별도로 실행 중인 Access·Document API가 필요합니다. API 주소는 `.env.local`의 `NEXT_PUBLIC_ACCESS_URL`, `NEXT_PUBLIC_BACKEND_URL`로 설정합니다.

## 검증

```bash
npm test
npm run build
```

같은 폴더에서 개발 서버 실행 중에는 프로덕션 빌드를 실행하지 않습니다. GitHub Actions는 전체 테스트와 빌드를 검증합니다.

## Vercel

이 GitHub 저장소를 Import하고 Framework를 Next.js, Root Directory를 저장소 루트(`.`), Node.js를 22.x로 설정합니다. Install Command는 `npm ci`, Build Command는 `npm run build`, Output Directory는 Next.js 기본값을 사용합니다.

Preview·Production별로 실제 HTTPS API 주소를 설정하고 배포합니다. `NEXT_PUBLIC_*`에는 공개 API 주소만 넣으며 비밀 키를 저장하지 않습니다. 백엔드 연결 전에는 업무 기능이 동작하지 않습니다.

자세한 구조·실행법은 [문서 안내](docs/README.md)를 참고하세요.
