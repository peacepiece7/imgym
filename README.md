# Oh My Img!

개인 운영용 이미지·에셋 변환 도구입니다. 이미지 검사와 웹 배포 패키지 생성부터 래스터 최적화, SVG 변환, 에셋 레시피, Markdown PDF 생성까지 한 화면에서 처리합니다.

- 운영 주소: <https://dev.margins.cloud/imgym>
- 기술 문서 시작점: [프로젝트 위키](./docs/wiki/home.md)
- 배포 절차: [수동 배포 가이드](./docs/manual-deployment.md)

## 제공 기능

| 작업 공간 | 주요 기능 |
| --- | --- |
| 웹 에셋 팩 | 이미지 사전 검사, 반응형 HTML/Next.js/디자인 산출물, WebP·AVIF, LQIP, manifest, 스트리밍 ZIP |
| 에셋 레시피 | 비율별 크롭, 아이콘, 팔레트·WCAG, OG 이미지, HEIC 변환, 배경 제거, 워터마크, GIF 영상화, WOFF2 서브셋, 직접 SVG 최적화 |
| 래스터 최적화 | PNG·JPEG·WebP 크롭, 리사이즈, 동일 포맷 최적화, 품질 게이트 기반 Auto 모드 |
| SVG 만들기 | 래스터 벡터화, 전처리, SVGO, 품질 게이트 기반 Auto 모드 |
| 문서를 PDF로 | UTF-8 Markdown을 선택 가능한 태그 PDF/UA-1 문서로 변환 |

업로드와 결과는 영구 저장하지 않습니다. 변환 중 필요한 파일만 요청별 임시 디렉터리에 만들고 완료·취소 시 제거합니다.

## 빠른 시작

요구 버전은 Node.js 24와 pnpm 10.7.1입니다. 전체 기능에는 ImageMagick, FFmpeg, FontTools/Brotli, librsvg, WeasyPrint 68.1과 Noto CJK가 필요하고 PDF 통합 검증에는 Poppler가 필요하므로 Docker가 기준 실행 환경입니다.

1. 32자 이상의 API 키를 생성합니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

2. 저장소 루트의 무시된 `.env`에 키를 기록합니다.

```dotenv
OHMYIMG_API_KEY=생성한-키
```

3. 개발 서버를 실행합니다.

```sh
pnpm install
pnpm dev
```

브라우저에서 <http://localhost:3000/imgym>을 엽니다. UI에 입력한 키는 개인 브라우저의 `localStorage.ohmyimgapikey`에 저장되고 매 API 요청의 Bearer 인증값으로 전송됩니다.

## 자주 쓰는 명령

```sh
pnpm dev                         # 개발 서버
pnpm lint                        # ESLint
pnpm test                        # 단위·프로세스·라우트 테스트
pnpm build                       # Next.js 프로덕션 빌드
pnpm audit:assets -- public      # 에셋 예산·메타데이터·중복 감사
pnpm calibrate                   # 실행 중인 서버를 대상으로 품질 보정 보고서 생성

docker build -t oh-my-img .      # 테스트와 빌드를 포함한 기준 이미지 생성
docker compose up -d --build     # 운영 형태로 로컬 기동
```

## API와 보안 경계

모든 변환 API는 다음 헤더를 요구합니다.

```http
Authorization: Bearer <OHMYIMG_API_KEY>
```

공개 헬스 체크는 `GET /imgym/api/health`입니다. 주요 변환 경로는 다음과 같습니다.

```text
POST /imgym/api/v1/inspect-assets
POST /imgym/api/v1/web-assets
POST /imgym/api/v1/web-assets/preview
POST /imgym/api/v1/asset-recipes
POST /imgym/api/v1/asset-recipes/preview
POST /imgym/api/v1/media-recipes
POST /imgym/api/v1/optimize-raster
POST /imgym/api/v1/vectorize
POST /imgym/api/v1/optimize-svg
POST /imgym/api/v1/docs-to-pdf
```

인증은 multipart 파싱 전에 수행합니다. 서버 키 설정이 없거나 잘못되면 503, 요청 키가 없거나 틀리면 401, 처리 슬롯이 가득 차면 429를 반환합니다. 기본 동시 작업 수는 프로세스당 1개이며 `OHMYIMG_MAX_CONCURRENT_JOBS`로 최대 4개까지 설정할 수 있습니다.

## 프로젝트를 다시 이해할 때

다음 순서로 읽으면 현재 구조를 빠르게 복원할 수 있습니다.

1. [위키 홈](./docs/wiki/home.md) — 문서 지도와 현재 상태
2. [프로젝트 구조](./docs/wiki/project-shape.md) — 런타임, 코드 계층, 신뢰 경계
3. [작업 흐름과 API](./docs/wiki/workflows-and-api.md) — 기능별 파이프라인과 제한
4. [운영 가이드](./docs/wiki/operations.md) — 로컬 실행과 배포
5. [유지보수 가이드](./docs/wiki/maintenance.md) — 변경 위치, 불변 조건, 완료 기준

상세한 연구·설계·검토 기록은 [문서 색인](./docs/README.md)에 보존합니다. 위키는 현재 동작을 설명하고, 날짜가 붙은 검토 문서는 당시의 증거와 의사결정을 설명합니다.
