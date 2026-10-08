export type ApiTag = "System" | "Inspect" | "Build" | "Optimize" | "Convert";

export interface ApiFieldDoc {
  name: string;
  type: string;
  required: string;
  description: string;
}

export interface ApiOptionExample {
  /** Names the variant, e.g. the recipe this options object selects. */
  label: string;
  options: string;
}

export interface ApiEndpointDoc {
  id: string;
  method: "GET" | "POST";
  path: string;
  tag: ApiTag;
  title: string;
  summary: string;
  description: string;
  fields: ApiFieldDoc[];
  responseType: string;
  responseDescription: string;
  limits: string[];
  responseHeaders: string[];
  /** Every one of these is asserted against the endpoint's real parser. */
  examples?: readonly ApiOptionExample[];
  curl: string;
}

export const API_BASE_PATH = "/imgym";
export const API_REFERENCE_VERSION = "1.1.0";
export const API_TAGS: readonly ApiTag[] = ["System", "Inspect", "Build", "Optimize", "Convert"];

const AUTH = '-H "Authorization: Bearer ${OHMYIMG_API_KEY}"';
const BASE = "${BASE_URL}";

export const API_ENDPOINTS: readonly ApiEndpointDoc[] = [
  {
    id: "health",
    method: "GET",
    path: "/api/health",
    tag: "System",
    title: "서비스 상태 확인",
    summary: "인증 없이 API 키 설정과 서비스 준비 상태를 확인합니다.",
    description: "로드밸런서, 배포 확인, 가벼운 업타임 모니터링에 적합한 공개 엔드포인트입니다.",
    fields: [],
    responseType: "application/json",
    responseDescription: '정상일 때 200과 {"status":"healthy"}, 키 설정이 잘못됐을 때 503을 반환합니다.',
    limits: ["공개 호출", "변환 작업 슬롯을 사용하지 않음"],
    responseHeaders: ["Cache-Control: no-store"],
    curl: `curl --fail-with-body ${BASE}/api/health`,
  },
  {
    id: "openapi",
    method: "GET",
    path: "/api/openapi",
    tag: "System",
    title: "OpenAPI 명세 다운로드",
    summary: "모든 API의 요청·응답 계약을 OpenAPI 3.1 JSON으로 받습니다.",
    description: "인증 없이 읽을 수 있으며 Postman 같은 API 클라이언트에 가져올 수 있습니다. 서버 키는 명세에 포함되지 않습니다.",
    fields: [],
    responseType: "application/json",
    responseDescription: "OpenAPI 3.1 문서. servers의 URL에 paths의 경로를 붙여 호출합니다.",
    limits: ["공개 호출", "캐시 최대 300초"],
    responseHeaders: ["Cache-Control: public, max-age=300"],
    curl: `curl --fail-with-body -o imgym-openapi.json ${BASE}/api/openapi`,
  },
  {
    id: "inspect-assets",
    method: "POST",
    path: "/api/v1/inspect-assets",
    tag: "Inspect",
    title: "이미지 사전 검사",
    summary: "이미지의 실제 형식, 크기, 색상·메타데이터 신호를 안전하게 검사합니다.",
    description: "GPS 같은 원본 메타데이터 값은 노출하지 않고 존재 여부만 반환합니다. 여러 파일의 일부 실패도 항목별로 보고합니다.",
    fields: [
      { name: "images", type: "file[]", required: "필수 · 반복", description: "정적 PNG, JPEG 또는 WebP 이미지" },
    ],
    responseType: "application/json",
    responseDescription: "각 파일의 상태와 서명 기반 MIME, 표시 크기, 알파, 방향, ICC/CICP, 메타데이터 존재 여부를 반환합니다.",
    limits: ["1–10개", "파일당 10 MiB", "요청 전체 50 MiB"],
    responseHeaders: ["X-Request-Id"],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F images=@hero.png \\\n  -F images=@card.jpg \\\n  ${BASE}/api/v1/inspect-assets`,
  },
  {
    id: "web-assets",
    method: "POST",
    path: "/api/v1/web-assets",
    tag: "Build",
    title: "웹 에셋 팩 생성",
    summary: "반응형 이미지, 코드 조각, 품질 기록을 하나의 ZIP으로 생성합니다.",
    description: "기기별 포맷(devices) 또는 한 장(single) 프로필로 후보를 만들고 화질 게이트를 통과한 결과만 패키징합니다. crop을 주면 크기 조정 전에 잘라냅니다.",
    fields: [
      { name: "images", type: "file[]", required: "필수 · 반복", description: "정적 PNG, JPEG 또는 WebP 이미지" },
      { name: "options", type: "JSON string", required: "필수", description: "프로필, 자르기 영역, 크기, 대체 텍스트, 출력 형식 설정" },
    ],
    responseType: "application/zip",
    responseDescription: "생성 이미지, 대상별 코드, 결정 기록이 담긴 manifest.json을 스트리밍합니다.",
    limits: ["1–10개", "파일당 10 MiB", "요청 전체 50 MiB", "ZIP 최대 260개 엔트리 / 128 MiB"],
    responseHeaders: ["X-Asset-Succeeded", "X-Asset-Failed", "X-Output-Files", "X-Output-Bytes", "X-Processing-Ms"],
    examples: [
    { label: "devices · 기기별 포맷", options: `{
  "profile": "devices",
  "targetSize": "original",
  "crop": null,
  "sizes": "(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px",
  "contentHint": "auto",
  "colorPolicy": "preserve",
  "altKind": "informative",
  "altText": "해 질 녘의 산 능선",
  "loading": "lazy",
  "includeWebp": true,
  "includeAvif": true,
  "includePlaceholder": true
}` },
    { label: "single · 원본 한 장 + 크롭", options: `{
  "profile": "single",
  "targetSize": "mobile",
  "crop": {
    "x": 0.25,
    "y": 0.25,
    "width": 0.5,
    "height": 0.5
  },
  "sizes": "100vw",
  "contentHint": "photo",
  "colorPolicy": "preserve",
  "altKind": "informative",
  "altText": "해 질 녘의 산 능선",
  "loading": "lcp",
  "includeWebp": false,
  "includeAvif": false,
  "includePlaceholder": true
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F images=@hero.png \\\n  -F 'options={"profile":"devices","targetSize":"original","crop":null,"sizes":"(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px","contentHint":"auto","colorPolicy":"preserve","altKind":"informative","altText":"Mountain at sunset","loading":"lazy","includeWebp":true,"includeAvif":true,"includePlaceholder":true}' \\\n  -o web-assets.zip \\\n  ${BASE}/api/v1/web-assets`,
  },
  {
    id: "asset-recipes",
    method: "POST",
    path: "/api/v1/asset-recipes",
    tag: "Build",
    title: "에셋 레시피 실행",
    summary: "크롭 세트, 아이콘, 팔레트, OG 이미지 같은 반복 산출물을 만듭니다.",
    description: "허용된 레시피만 실행하며 ImageMagick 명령 같은 저수준 옵션은 받지 않습니다.",
    fields: [
      { name: "asset", type: "file", required: "필수", description: "레시피에 맞는 이미지 또는 HEIC 파일" },
      { name: "options", type: "JSON string", required: "필수", description: "recipe와 해당 레시피의 제한된 설정" },
    ],
    responseType: "application/zip",
    responseDescription: "생성 파일과 버전이 명시된 manifest.json을 ZIP으로 스트리밍합니다.",
    limits: ["파일 1개", "최대 20 MiB", "recipe: frame · icons · palette · social · heic · background · watermark"],
    responseHeaders: ["X-Output-Files", "X-Output-Bytes"],
    examples: [
      { label: "frame · 비율 크롭", options: `{
  "recipe": "frame",
  "aspects": [
    "1:1",
    "16:9"
  ],
  "focusX": 50,
  "focusY": 42,
  "rotate": 0,
  "flipX": false,
  "flipY": false,
  "trim": false,
  "padding": 0,
  "background": "#ffffff"
}` },
      { label: "icons · 파비콘·앱 아이콘", options: `{
  "recipe": "icons",
  "background": "#ffffff",
  "padding": 12,
  "includeNative": false
}` },
      { label: "palette · 색 추출", options: `{
  "recipe": "palette",
  "colors": 5,
  "background": "#ffffff"
}` },
      { label: "social · OG 카드", options: `{
  "recipe": "social",
  "title": "제품 업데이트",
  "subtitle": "2026년 9월",
  "alt": "제품 업데이트 공유 카드",
  "background": "#111827",
  "textColor": "#ffffff"
}` },
      { label: "background · 배경 제거", options: `{
  "recipe": "background",
  "color": "#ffffff",
  "fuzz": 10
}` },
      { label: "watermark · 워터마크", options: `{
  "recipe": "watermark",
  "text": "@peacepiece",
  "position": "southeast",
  "opacity": 40,
  "color": "#ffffff"
}` },
      { label: "heic · HEIC 입력 변환", options: `{
  "recipe": "heic"
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F asset=@product.png \\\n  -F 'options={"recipe":"icons","background":"#ffffff","padding":12,"includeNative":false}' \\\n  -o icons-asset-recipe.zip \\\n  ${BASE}/api/v1/asset-recipes`,
  },
  {
    id: "web-assets-preview",
    method: "POST",
    path: "/api/v1/web-assets/preview",
    tag: "Build",
    title: "웹 에셋 미리보기",
    summary: "웹 에셋 팩의 대표 이미지 한 장을 바이너리로 반환합니다.",
    description: "web-assets와 같은 options를 사용하며 images는 정확히 한 파일만 보냅니다. 가장 큰 기본 포맷 산출물을 선택합니다. 미리보기 후 ZIP이 필요하면 web-assets를 별도로 호출합니다.",
    fields: [
      { name: "images", type: "file", required: "필수", description: "정적 PNG, JPEG 또는 WebP 한 장" },
      { name: "options", type: "JSON string", required: "필수", description: "web-assets와 같은 설정" },
    ],
    responseType: "image/png · image/jpeg · image/webp",
    responseDescription: "대표 이미지와 크기·품질 측정 헤더를 반환합니다. 생성 가능한 이미지가 없으면 422입니다.",
    limits: ["파일 1개", "최대 10 MiB", "전체 팩 생성과 같은 처리 슬롯 사용"],
    responseHeaders: ["X-Output-Bytes", "X-Output-Width", "X-Output-Height", "X-Output-Format", "X-Quality-Gate", "X-SSIM", "X-MAE", "X-Edge-MAE", "X-Alpha-MAE"],
    examples: [{ label: "single · 한 장 미리보기", options: '{"profile":"single","targetSize":"mobile","crop":null,"sizes":"100vw","contentHint":"auto","colorPolicy":"preserve","altKind":"informative","altText":"제품 이미지","loading":"lazy","includeWebp":false,"includeAvif":false,"includePlaceholder":false}' }],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F images=@hero.png \\\n  -F 'options={"profile":"single","targetSize":"mobile","crop":null,"sizes":"100vw","contentHint":"auto","colorPolicy":"preserve","altKind":"informative","altText":"Product image","loading":"lazy","includeWebp":false,"includeAvif":false,"includePlaceholder":false}' \\\n  -o web-preview.png \\\n  ${BASE}/api/v1/web-assets/preview`,
  },
  {
    id: "asset-recipes-preview",
    method: "POST",
    path: "/api/v1/asset-recipes/preview",
    tag: "Build",
    title: "에셋 레시피 미리보기",
    summary: "레시피의 대표 이미지를 ZIP 없이 바로 받습니다.",
    description: "asset-recipes와 같은 asset과 options를 사용합니다. 각 레시피가 정한 대표 이미지를 반환하며, 전체 산출물이 필요하면 asset-recipes를 별도로 호출합니다.",
    fields: [
      { name: "asset", type: "file", required: "필수", description: "레시피에 맞는 이미지 또는 HEIC 파일" },
      { name: "options", type: "JSON string", required: "필수", description: "asset-recipes와 같은 설정" },
    ],
    responseType: "image/png · image/jpeg · image/webp",
    responseDescription: "대표 이미지와 출력 역할·크기 헤더를 반환합니다. 미리보기 생성에 실패하면 422입니다.",
    limits: ["파일 1개", "최대 20 MiB", "frame · icons · palette · social · heic · background · watermark"],
    responseHeaders: ["X-Output-Bytes", "X-Output-Width", "X-Output-Height", "X-Output-Role"],
    examples: [{ label: "icons · 아이콘 미리보기", options: '{"recipe":"icons","background":"#ffffff","padding":12,"includeNative":false}' }],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F asset=@product.png \\\n  -F 'options={"recipe":"icons","background":"#ffffff","padding":12,"includeNative":false}' \\\n  -o icon-preview.png \\\n  ${BASE}/api/v1/asset-recipes/preview`,
  },
  {
    id: "media-recipes",
    method: "POST",
    path: "/api/v1/media-recipes",
    tag: "Build",
    title: "미디어 레시피 실행",
    summary: "GIF의 웹 영상 세트 또는 글꼴의 WOFF2 서브셋을 생성합니다.",
    description: "GIF는 무음 반복 영상으로, 글꼴은 사용 문자만 담은 WOFF2와 CSS로 변환합니다.",
    fields: [
      { name: "asset", type: "file", required: "필수", description: "GIF 또는 TTF/OTF/TTC/WOFF/WOFF2" },
      { name: "options", type: "JSON string", required: "필수", description: "gif-video 또는 font 레시피 설정" },
    ],
    responseType: "application/zip",
    responseDescription: "영상·포스터·HTML 또는 WOFF2·CSS·권리 확인 기록을 ZIP으로 반환합니다.",
    limits: ["파일 1개", "최대 20 MiB", "GIF 최대 30초 / 30fps", "글꼴 text 최대 5,000자"],
    responseHeaders: ["X-Output-Files"],
    examples: [
      { label: "gif-video · GIF를 영상으로", options: `{
  "recipe": "gif-video",
  "background": "#ffffff"
}` },
      { label: "font · 폰트 서브셋", options: `{
  "recipe": "font",
  "family": "Pretendard",
  "text": "안녕하세요 Oh My Img",
  "licenseConfirmed": true
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F asset=@motion.gif \\\n  -F 'options={"recipe":"gif-video","background":"#ffffff"}' \\\n  -o gif-video-recipe.zip \\\n  ${BASE}/api/v1/media-recipes`,
  },
  {
    id: "optimize-raster",
    method: "POST",
    path: "/api/v1/optimize-raster",
    tag: "Optimize",
    title: "래스터 이미지 최적화",
    summary: "이미지를 자르고 줄인 뒤 입력과 같은 포맷으로 최적화합니다.",
    description: "정규화 좌표로 크롭하며 확대는 하지 않습니다. auto 모드는 서버가 관리하는 후보 중 화질 기준을 만족하는 가장 작은 결과를 고릅니다.",
    fields: [
      { name: "image", type: "file", required: "필수", description: "정적 PNG, JPEG 또는 WebP 이미지" },
      { name: "options", type: "JSON string", required: "필수", description: "crop, 선택적 resize, mode와 auto 정책" },
    ],
    responseType: "image/png · image/jpeg · image/webp",
    responseDescription: "입력과 같은 포맷의 최적화된 이미지 바이너리를 반환합니다.",
    limits: ["최대 10 MiB", "한 변 8,192 px", "최대 25 MP", "애니메이션 제외"],
    responseHeaders: ["X-Original-Bytes", "X-Output-Bytes", "X-Output-Width", "X-Output-Height", "X-Selected-Preset", "X-Processing-Ms"],
    examples: [
      { label: "auto · 기준을 만족하는 최소 용량", options: `{
  "crop": {
    "x": 0,
    "y": 0,
    "width": 1,
    "height": 1
  },
  "resize": {
    "maxWidth": 1600
  },
  "mode": "auto",
  "optimization": {
    "policy": "standard"
  }
}` },
      { label: "balanced · 고정 프리셋 + 크롭", options: `{
  "crop": {
    "x": 0.1,
    "y": 0.1,
    "width": 0.8,
    "height": 0.8
  },
  "resize": {
    "maxWidth": 1200,
    "maxHeight": 1200
  },
  "mode": "balanced"
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F image=@photo.jpg \\\n  -F 'options={"crop":{"x":0,"y":0,"width":1,"height":1},"resize":{"maxWidth":1600},"mode":"auto","optimization":{"policy":"standard"}}' \\\n  -o photo-optimized.jpg \\\n  ${BASE}/api/v1/optimize-raster`,
  },
  {
    id: "vectorize",
    method: "POST",
    path: "/api/v1/vectorize",
    tag: "Convert",
    title: "래스터를 SVG로 변환",
    summary: "정적 이미지를 안전하게 정리된 SVG와 측정 결과로 변환합니다.",
    description: "수동 프리셋에서는 선택적 전처리를 사용할 수 있습니다. auto와 cleanup은 동시에 사용할 수 없습니다.",
    fields: [
      { name: "image", type: "file", required: "필수", description: "정적 PNG, JPEG 또는 WebP 이미지" },
      { name: "preset", type: "string", required: "필수", description: "accurate · balanced · tiny · auto" },
      { name: "cleanup", type: "JSON string", required: "선택", description: "수동 프리셋용 버전 1 전처리 설정" },
    ],
    responseType: "application/json",
    responseDescription: "SVG 문자열, 다운로드 이름, 입출력 크기, 처리 시간, 선택 후보와 SVG 복잡도 통계를 반환합니다.",
    limits: ["최대 10 MiB", "한 변 8,192 px", "최대 40 MP", "애니메이션 제외"],
    responseHeaders: ["X-Request-Id"],
    examples: [
      { label: "cleanup · 수동 프리셋 전처리", options: `{
  "version": 1,
  "cleanup": 2,
  "colors": 64,
  "advanced": {
    "alphaCutoff": 16,
    "gradientStep": 32
  }
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F image=@logo.png \\\n  -F preset=balanced \\\n  -F 'cleanup={"version":1,"cleanup":2,"colors":64}' \\\n  ${BASE}/api/v1/vectorize`,
  },
  {
    id: "optimize-svg",
    method: "POST",
    path: "/api/v1/optimize-svg",
    tag: "Optimize",
    title: "SVG 정리 및 최적화",
    summary: "직접 올린 SVG에서 위험 요소를 제거하고 용량을 줄입니다.",
    description: "스크립트, 이벤트 핸들러, 외부 참조와 위험한 마크업은 제거하고 안전한 자체 포함 CSS와 그래디언트는 보존합니다.",
    fields: [
      { name: "image", type: "file", required: "필수", description: "SVG 파일" },
      { name: "precision", type: "integer", required: "선택 · 기본 3", description: "좌표 정밀도 2 · 3 · 4" },
    ],
    responseType: "application/json",
    responseDescription: "정리된 SVG, 절감 바이트, 요소 통계, 제거된 위험 요소 개수를 반환합니다.",
    limits: ["최대 2 MiB", "최대 50,000개 요소", "DOCTYPE / ENTITY 거부"],
    responseHeaders: ["X-Request-Id", "X-Content-Type-Options: nosniff"],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F image=@icon.svg \\\n  -F precision=3 \\\n  ${BASE}/api/v1/optimize-svg`,
  },
  {
    id: "docs-to-pdf",
    method: "POST",
    path: "/api/v1/docs-to-pdf",
    tag: "Convert",
    title: "Markdown을 PDF로 변환",
    summary: "UTF-8 Markdown을 구조가 살아 있는 PDF/UA-1 문서로 렌더링합니다.",
    description: "document 파일과 markdown 문자열 중 정확히 하나만 보냅니다. 원격 이미지, 임의 HTML·CSS·JavaScript는 처리하지 않습니다.",
    fields: [
      { name: "document", type: "file", required: "둘 중 하나", description: "UTF-8 .md, .markdown 또는 .txt" },
      { name: "markdown", type: "string", required: "둘 중 하나", description: "비어 있지 않은 UTF-8 Markdown" },
      { name: "options", type: "JSON string", required: "선택", description: "제목, 언어, 용지, 방향, 템플릿, 페이지 번호" },
    ],
    responseType: "application/pdf",
    responseDescription: "다운로드 가능한 PDF/UA-1 바이너리와 렌더링 측정 헤더를 반환합니다.",
    limits: ["Markdown 최대 1 MiB", "최대 100페이지", "PDF 최대 24 MiB", "렌더링 제한 45초"],
    responseHeaders: ["X-Input-Bytes", "X-Output-Bytes", "X-Output-Pages", "X-Processing-Ms", "X-PDF-Renderer", "X-PDF-Variant"],
    examples: [
      { label: "document · 일반 문서", options: `{
  "title": "제품 가이드",
  "lang": "ko",
  "pageSize": "a4",
  "orientation": "portrait",
  "template": "document",
  "includePageNumbers": true
}` },
      { label: "resume · 이력서 템플릿", options: `{
  "title": "이력서",
  "lang": "ko",
  "pageSize": "a4",
  "orientation": "portrait",
  "template": "resume",
  "includePageNumbers": false
}` },
    ],
    curl: `curl --fail-with-body \\\n  ${AUTH} \\\n  -F document=@guide.md \\\n  -F 'options={"title":"Product guide","lang":"en","pageSize":"a4","orientation":"portrait","template":"document","includePageNumbers":true}' \\\n  -o guide.pdf \\\n  ${BASE}/api/v1/docs-to-pdf`,
  },
] as const;
