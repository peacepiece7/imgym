# 서버에서 Oh My Img! API 사용하기

운영 Base URL은 `https://dev.margins.cloud/imgym`입니다. 미리보기를 포함한 변환 API 10개를 같은 Bearer 키로 호출합니다.

- [브라우저 API 문서](https://dev.margins.cloud/imgym/api-docs): 요청 필드, 제한, 레시피별 옵션 예시와 복사 가능한 curl.
- [OpenAPI 3.1 JSON](https://dev.margins.cloud/imgym/api/openapi): 전체 경로, 인증, multipart 계약, 옵션 객체 스키마와 응답. API 클라이언트에 가져올 수 있습니다.

## 연결과 인증

`dev.margins.cloud`는 Tailnet의 개발 서버를 가리킵니다. 호출 서버에서 해당 도메인의 DNS 조회와 HTTPS 연결이 가능해야 합니다. 이 조건을 만족하면 호출자의 호스트·IP·Origin에 따른 추가 제한은 없습니다. 서버 간 curl, fetch, requests 호출에는 CORS 설정이 필요하지 않습니다. 별도 도메인의 브라우저 JavaScript는 현재 지원 범위에 포함하지 않습니다.

서버 운영자가 `/opt/imgym/.env`에 설정한 `OHMYIMG_API_KEY`를 호출 서버의 환경 변수 또는 비밀 저장소에 설정합니다. 모든 변환과 미리보기는 다음 헤더를 필요로 합니다.

```http
Authorization: Bearer <OHMYIMG_API_KEY>
```

문서, OpenAPI, 헬스 체크는 공개입니다. API 키를 URL, multipart 필드나 소스 코드에 넣지 않습니다. 응답이나 OpenAPI를 통해 키를 조회하는 기능은 없습니다.

```sh
export BASE_URL='https://dev.margins.cloud/imgym'
# OHMYIMG_API_KEY는 호출 서버의 환경에 이미 설정되어 있다고 가정합니다.
curl --fail-with-body "$BASE_URL/api/health"
# 정상: {"status":"healthy"}

curl --fail-with-body \
  -H "Authorization: Bearer ${OHMYIMG_API_KEY}" \
  -F image=@icon.svg \
  -F precision=3 \
  "$BASE_URL/api/v1/optimize-svg"
```

Base URL에 `/imgym`을 포함하고 아래 경로를 붙입니다. 도메인의 `/api/...`는 다른 애플리케이션이 처리하므로 imgym API 호출에 사용하지 않습니다.

## 전체 경로

| 메서드·경로 (Base URL 뒤) | multipart 필드 | 성공 응답 |
| --- | --- | --- |
| GET `/api/health` | 없음, 공개 | `{"status":"healthy"}` 또는 503 unhealthy |
| GET `/api/openapi` | 없음, 공개 | OpenAPI 3.1 JSON |
| POST `/api/v1/inspect-assets` | 반복 `images` | 파일별 검사 JSON |
| POST `/api/v1/web-assets` | 반복 `images`, `options` JSON 문자열 | 웹 에셋 ZIP |
| POST `/api/v1/web-assets/preview` | `images` 정확히 한 파일, `options` | 대표 이미지 바이너리 |
| POST `/api/v1/asset-recipes` | `asset` 한 파일, `options` | 이미지 레시피 ZIP |
| POST `/api/v1/asset-recipes/preview` | `asset` 한 파일, `options` | 대표 이미지 바이너리 |
| POST `/api/v1/media-recipes` | `asset` 한 파일, `options` | GIF 영상 또는 폰트 ZIP |
| POST `/api/v1/optimize-raster` | `image` 한 파일, `options` | 입력과 같은 PNG/JPEG/WebP |
| POST `/api/v1/vectorize` | `image`, `preset`, 선택적 `cleanup` | SVG 문자열과 측정값 JSON |
| POST `/api/v1/optimize-svg` | `image` SVG, 선택적 `precision` | 안전하게 정리한 SVG와 통계 JSON |
| POST `/api/v1/docs-to-pdf` | `document` 파일 또는 `markdown` 문자열 중 하나, 선택적 `options` | PDF/UA-1 바이너리 |

모든 POST는 `multipart/form-data`입니다. `options`와 `cleanup`만 JSON을 직렬화한 문자열이고, 요청 본문 전체를 JSON으로 보내지 않습니다. curl `-F`, fetch `FormData`, requests의 `files`가 Content-Type과 multipart boundary를 설정하므로 Content-Type 헤더를 직접 지정하지 않습니다. API 문서에는 각 경로의 완전한 curl 예시가 있습니다.

## 옵션 계약

OpenAPI `components.schemas`에는 아래 객체 스키마가 있습니다. multipart 문자열 필드의 `contentSchema`가 해당 스키마를 참조합니다. 다음 표의 필수 필드를 모두 보내세요. PDF 옵션만 누락된 값을 기본값으로 채웁니다.

### 웹 에셋과 미리보기

`WebAssetOptions`를 두 경로에서 동일하게 사용합니다.

| 필드 | 허용 값·의미 |
| --- | --- |
| `profile` | `devices` 또는 `single` |
| `targetSize` | `original`, `mobile`(640), `tablet`(1024), `desktop`(1920); single에서 적용, 확대 없음 |
| `sizes` | 최대 256자, `<`, `>`, 개행 제외; 예: `100vw` |
| `contentHint` | `auto`, `photo`, `ui`, `logo`, `transparent` |
| `colorPolicy` | `preserve` 또는 실제 ICC 변환을 수행하는 `srgb` |
| `altKind`, `altText` | `decorative`, `functional`, `informative`, `complex`; decorative 외에는 공백이 아닌 텍스트, 최대 300자 |
| `loading` | `lcp` 또는 `lazy` |
| `includeWebp`, `includeAvif`, `includePlaceholder` | boolean, 세 필드 모두 필수 |
| 선택 `crop` | 정규화 크롭, 생략/null이면 전체 프레임 |
| 선택 `crops`, `accessibility` | 입력 파일 순서에 대응하는 배열, 파일 수와 같아야 함 |
| 선택 `customWidths` | devices 전용, 16–8192 정수 1–8개; 기본 640/1024/1920 대체 |

미리보기는 가장 큰 기본 포맷 결과를 반환합니다. 요청 시 전체 생성 파이프라인을 실행하므로 가벼운 검사 용도로는 `inspect-assets`를 사용합니다. 미리보기 결과는 다음 ZIP 요청에 재사용되지 않습니다.

### 이미지 레시피와 미리보기

`AssetRecipeOptions`에서 `recipe`와 해당 행의 필드를 모두 전달합니다. 모든 색상은 `#rrggbb` 형식입니다.

| recipe | 필수 필드·범위 |
| --- | --- |
| `frame` | `aspects`: 1–6개(`1:1`, `4:3`, `3:2`, `16:9`, `2:1`, `9:16`); `focusX`, `focusY`: 0–100%; `rotate`: 0/90/180/270; `flipX`, `flipY`, `trim`: boolean; `padding`: 0–256 정수 px; `background` |
| `icons` | `background`, `padding`: 0–40 정수 %, `includeNative`: boolean |
| `palette` | `colors`: 3–8 정수, `background` |
| `social` | `title`: 1–90자, `subtitle`: 0–140자, `alt`: 1–300자, `background`, `textColor` |
| `heic` | 추가 필드 없음; HEIC 파일 필요, SDR 8비트 첫 프레임만 지원 |
| `background` | `color`, `fuzz`: 0–20; 단색 유사도 기반 배경 제거 |
| `watermark` | `text`: 1–80자, `position`: northwest/northeast/southwest/southeast/center, `opacity`: 10–100, `color` |

미리보기 경로도 7개 레시피를 지원합니다. 전체 ZIP은 `manifest.json`에 출력 경로·MIME·바이트·SHA-256을 기록합니다.

### 미디어 레시피

| recipe | 필수 필드·범위 |
| --- | --- |
| `gif-video` | `background`: `#rrggbb`; WebM, MP4, PNG 포스터와 HTML 생성, 최대 30초·30fps |
| `font` | `family`: 문자·숫자·공백·점·밑줄·하이픈으로 구성된 1–80자; `text`: 공백이 아닌 최대 5,000자; `licenseConfirmed`: 반드시 true |

폰트 입력은 TTF/OTF/TTC/WOFF/WOFF2이고, TTC는 첫 글꼴을 사용합니다. WOFF2·CSS·권리 확인 기록을 출력하며 서브셋·임베딩 권한이 있는 글꼴만 전달합니다.

### 래스터, 벡터, SVG와 PDF

- `OptimizeRasterOptions`: `crop`과 `mode` 필수. crop은 `{ "x": 0, "y": 0, "width": 1, "height": 1 }` 같은 0–1 좌표이며 너비·높이는 양수, 영역은 이미지 안에 있어야 합니다. 선택적 `resize.maxWidth`, `resize.maxHeight`는 1–8192 정수이고 확대하지 않습니다. `mode`: high/balanced/small/auto. 선택적 `optimization.policy`: standard(기본)/smaller; smaller는 auto에서만 허용합니다.
- `vectorize`: `preset`은 accurate/balanced/tiny/auto. `cleanup`은 선택이며 생략하면 전처리하지 않습니다. `VectorCleanupOptionsV1`의 `version: 1`, `cleanup: 0–4` 정수, `colors: 3/4/6/8/16/32/64/128/"full"` 필수. 선택적 advanced는 speckleSize(0–128), alphaCutoff(0–255), gradientStep(0–128), colorPrecision(1–8) 정수와 pathSimplify(0–4)입니다. auto에 cleanup을 보내면 400입니다.
- `optimize-svg`: `precision`은 2/3/4, 기본 3. JSON의 `svg`를 파일에 저장하면 됩니다.
- `DocumentPdfOptions`: 모든 필드 선택. title(기본 Document, 1–200자), lang(ko/en, 기본 ko), pageSize(a4/letter, 기본 a4), orientation(portrait/landscape, 기본 portrait), template(document/resume, 기본 document), includePageNumbers(boolean, 기본 true). `document`와 `markdown`은 정확히 하나만 보냅니다. 원격 이미지와 임의 HTML·CSS·JS는 렌더링하지 않습니다.

## 클라이언트 예시

Node.js 24에서 추가 라이브러리 없이 이미지를 최적화합니다. 서버 환경에 API 키를 설정하고 실행하세요.

```js
import { readFile, writeFile } from "node:fs/promises";

const form = new FormData();
form.set("image", new File([await readFile("photo.jpg")], "photo.jpg", { type: "image/jpeg" }));
form.set("options", JSON.stringify({
  crop: { x: 0, y: 0, width: 1, height: 1 },
  resize: { maxWidth: 1600 },
  mode: "auto",
  optimization: { policy: "standard" },
}));
const response = await fetch("https://dev.margins.cloud/imgym/api/v1/optimize-raster", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.OHMYIMG_API_KEY}` },
  body: form,
  signal: AbortSignal.timeout(300_000),
});
if (!response.ok) {
  throw new Error(`HTTP ${response.status}; requestId=${response.headers.get("x-request-id")}; ${await response.text()}`);
}
await writeFile("photo-optimized.jpg", Buffer.from(await response.arrayBuffer()));
```

Python에서 `requests`로 PDF를 받습니다 (`pip install requests`).

```python
import os
import requests

response = requests.post(
    "https://dev.margins.cloud/imgym/api/v1/docs-to-pdf",
    headers={"Authorization": f"Bearer {os.environ['OHMYIMG_API_KEY']}"},
    files={"markdown": (None, "# API 가이드\n\n한국어 Markdown 문서입니다.")},
    timeout=(10, 300),
)
response.raise_for_status()
with open("guide.pdf", "wb") as output:
    output.write(response.content)
```

ZIP·PDF·이미지는 바이너리로 저장하고 vectorize/optimize-svg/inspect-assets는 JSON으로 읽습니다. 다운로드 파일명은 `Content-Disposition`, 추적 ID는 `X-Request-Id`입니다. 변환 응답은 `Cache-Control: no-store`입니다. 200 ZIP도 웹 에셋 일부 실패를 포함할 수 있으므로 `manifest.summary.failed` 또는 `X-Asset-Failed`를 확인하세요. 검사 JSON도 각 `items[].status`를 확인합니다.

## 제한과 오류 처리

| 입력 | 제한 |
| --- | --- |
| 웹 에셋·검사 | 정적 PNG/JPEG/WebP, 1–10개, 파일당 10 MiB, 전체 50 MiB; 미리보기는 한 파일 |
| 래스터 | 10 MiB, 한 변 8192px, 25 MP, 정적 이미지 |
| 벡터화 | 10 MiB, 한 변 8192px, 40 MP, 정적 이미지 |
| 이미지·미디어 레시피 | 파일당 20 MiB, 파일 한 개 |
| 직접 SVG | 2 MiB, 최대 50,000 요소, DOCTYPE/ENTITY 거부 |
| PDF | UTF-8 Markdown 1 MiB, 최대 100페이지·24 MiB 출력, 렌더링 45초 |
| ZIP | 최대 260개 엔트리·128 MiB 비압축 데이터 |

오류는 보통 `{"error":"...","requestId":"..."}`이고 일부 입력 오류는 본문 requestId를 생략합니다. 헤더의 `X-Request-Id`는 모든 변환 응답에 포함됩니다. Nginx가 본문 상한을 초과한 요청을 거부하면 HTML 413일 수 있으므로 오류를 항상 JSON으로 파싱하지 않습니다.

| HTTP | 대응 |
| --- | --- |
| 400 | 필드·옵션·파일 형식 수정 |
| 401 | 호출 서버의 Bearer 키 확인 |
| 413 | 파일 또는 전체 요청 크기 줄이기 |
| 422 | 입력·레시피 확인, 유효한 산출물을 생성하지 못함 |
| 429 | `Retry-After: 1` 이후 재시도; 클라이언트 동시 요청 제한 |
| 500 | requestId로 서버 로그 확인 |
| 503 | 운영 서버의 API 키 설정 확인 |

기본 처리 슬롯은 프로세스당 하나입니다. 다운로드를 완료한 뒤 다음 변환을 요청하세요. 모든 작업은 동기식이며 결과를 영구 저장하거나 작업 ID로 다시 조회하지 않습니다.

## 운영 API 전체 검증

`scripts/verify-api.mjs`는 실제 HTTP를 통해 공개 엔드포인트, 모든 변환 경로의 누락·오류 키 401, 빈 입력 400, 공개 옵션 예시, 7개 레시피와 미리보기, GIF·폰트, 벡터 프리셋과 래스터 3포맷·4모드를 실행합니다. ZIP CRC·manifest의 SHA-256·크기와 바이너리 시그니처를 검사하고 결과 파일과 `report.json`을 출력합니다. 실패하면 0이 아닌 종료 코드로 끝납니다.

Linux 배포 서버에서 Docker 런타임과 호스트의 Tailnet 연결을 이용해 실행합니다. 기본 Docker 브리지의 내부 IP로 운영 Nginx에 요청하면 403이므로 `--network host`가 필요합니다. 키는 서버의 `.env`에서 읽고, 결과는 호스트의 임시 폴더에 남깁니다.

```sh
cd /opt/imgym
verification_dir="$(mktemp -d /tmp/imgym-api-verification.XXXXXX)"
docker run --rm -i --network host \
  --user "$(id -u):$(id -g)" \
  --env-file .env \
  -e API_BASE_URL=https://dev.margins.cloud/imgym \
  -e API_VERIFY_OUTPUT=/results \
  --mount "type=bind,src=$verification_dir,dst=/results" \
  imgym:local node --input-type=module < scripts/verify-api.mjs
```

`report.json`과 변환 파일은 `$verification_dir`에 저장됩니다.

다른 서버에서도 같은 스크립트를 실행할 수 있습니다. Node.js 24, ImageMagick(HEIC 포함), FontTools, Python 3과 수정 가능한 Noto 글꼴을 준비합니다. `.env`에 API 키를 설정한 저장소에서는 다음을 실행합니다.

```sh
API_VERIFY_FONT=/path/to/NotoSansCJK-Regular.ttc pnpm verify:api
```

이미 준비한 `source.png`, `source.jpg`, `source.webp`, `source.heic`, `motion.gif`, `font.otf`, `icon.svg`가 있는 폴더는 `API_VERIFY_FIXTURES`로 지정하면 ImageMagick·FontTools 없이도 호출을 검증할 수 있습니다. ZIP 검증에는 Python 3이 필요합니다. `API_VERIFY_OUTPUT`으로 결과 폴더를 지정하고 `API_BASE_URL`로 다른 배포를 선택합니다. API 키는 보고서에 기록하지 않습니다.

## 검증 기록

2026-10-08 운영 API 문서 v1.1.0을 외부 macOS 머신과 Linux 배포 서버의 Docker 호스트 네트워크에서 각각 검증했습니다. 두 환경 모두 변환 API 10개·성공 시나리오 42개·인증 거부 20건·빈 입력 거부 10건을 통과했습니다. 운영 Docker 빌드의 테스트 242개와 프로덕션 빌드도 통과했습니다. 이 검증에서 발견한 팔레트의 16비트 색상 파싱 오류를 수정했고, 한글 PDF 텍스트 추출과 문서 화면·검색·펼치기도 확인했습니다.
