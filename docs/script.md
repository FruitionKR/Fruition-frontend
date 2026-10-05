# Frontend 빌드·실행

모든 명령은 이 저장소 루트에서 Node.js 24로 실행합니다. 설치 버전은 `package-lock.json`을 따릅니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

개발 서버의 기본 주소는 `http://localhost:3000`입니다. `.env.local`에서 Access·Document 주소를 지정합니다. 값 변경 후 개발 서버를 재시작합니다.

| 환경변수 | 로컬 기본값 | 대상 |
|---|---|---|
| `ACCESS_URL` | `http://localhost:8081` | 인증·워크스페이스·멤버·초대 |
| `BACKEND_URL` | `http://localhost:8080` | 문서·Wiki·채팅·AI 업무 API. 설정하면 브라우저가 문서 API를 이 origin으로 직접 호출하고 PDF는 S3 multipart로 업로드 |
| `DOCUMENT_DIRECT_UPLOAD_ENABLED` | (비움) | `false`로만 PDF 직접 업로드를 끈다. 비우면 `BACKEND_URL` 설정 여부를 따른다 |

## 백엔드 없이 실행 (mock API)

```bash
npm run dev:mock
```

`mock/dev.mjs`가 `mock/server.mjs`(Access 8081 + Document 8080, 인메모리 상태)와 `next dev`(3000)를 함께 띄우고 Ctrl+C로 둘 다 종료합니다. `.env.local` 없이 기본 주소(`localhost:8081`, `localhost:8080`)로 연결되며, `ACCESS_CODE`가 비어 있어 접근 코드 게이트는 꺼집니다. mock 서버만 필요하면 `npm run mock`.

| 항목 | 값 |
|---|---|
| 데모 계정 | `demo@fruition.local` / `demo1234` (MFA 없음) |
| 이메일 인증번호 | 아무 6자리 숫자 또는 `9700` |
| 초대 링크 예시 | `http://localhost:3000/invitations/mock-invite-token` |

mock 서버는 요청마다 `METHOD path → status`를, 구현되지 않은 경로는 `mock: unhandled ...`를 터미널에 출력합니다. Ingest·변환·Lint는 타이머로 수 초 뒤 완료되며 상태는 프로세스 재시작 시 초기화됩니다.

`npm test`는 `tests/*.test.mjs` 전체를 실행합니다. 특정 영역은 `package.json`의 `test:*` 명령으로 확인합니다.

```bash
npm test
npm run build
npm start
```

같은 폴더의 개발 서버를 종료한 뒤 프로덕션 빌드를 실행합니다. GitHub Actions는 Node.js 24에서 `npm ci` → `npm test` → `npm run build` 순서로 검증합니다.

운영 이미지는 루트 `Dockerfile`로 빌드합니다. `SAME_ORIGIN_API=true` 빌드는 rewrite·redirect를 비우고 Next standalone 서버를 만들며, API 경로 분기는 ALB가 맡습니다. 컨테이너는 uid 10001로 3000번 포트를 열고 `/healthz`로 상태를 확인합니다. `/app/.next/cache`는 쓰기 가능한 볼륨이 필요합니다.

비밀값과 실제 환경 파일은 Git에 올리지 않습니다. AWS 리소스·DB·서비스 통합 실행은 별도 platform 저장소가 관리합니다.
