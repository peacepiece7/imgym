import { API_REFERENCE_VERSION } from "@/lib/api/docs";

const bearerSecurity = [{ bearerAuth: [] }];

const commonHeaders = {
  "X-Request-Id": {
    description: "요청 추적용 UUID",
    schema: { type: "string", format: "uuid" },
  },
  "Cache-Control": {
    description: "모든 변환 응답은 저장하지 않습니다.",
    schema: { type: "string", const: "no-store" },
  },
};

const errorResponse = (description: string) => ({
  description,
  headers: commonHeaders,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
});

const protectedErrors = {
  "400": errorResponse("요청 또는 옵션이 올바르지 않음"),
  "401": errorResponse("Bearer API 키가 없거나 올바르지 않음"),
  "413": errorResponse("업로드 또는 전체 요청이 허용 크기를 초과함"),
  "422": errorResponse("요청은 유효하지만 처리 가능한 결과를 만들 수 없음"),
  "429": {
    ...errorResponse("현재 변환 슬롯이 모두 사용 중임"),
    headers: {
      ...commonHeaders,
      "Retry-After": { description: "재시도 권장 시간(초)", schema: { type: "integer", const: 1 } },
    },
  },
  "500": errorResponse("예상하지 못한 처리 실패"),
  "503": errorResponse("서버 API 키 설정이 없거나 올바르지 않음"),
};

const jsonString = (description: string, example: string) => ({
  type: "string",
  description,
  contentMediaType: "application/json",
  examples: [example],
});

const multipart = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  },
});

const file = (description: string) => ({
  type: "string",
  format: "binary",
  description,
});

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Oh My Img! API",
    version: API_REFERENCE_VERSION,
    summary: "이미지·에셋·문서 변환을 위한 동기식 HTTP API",
    description: "모든 변환은 multipart/form-data로 요청하며 결과를 영구 저장하지 않습니다. preview 라우트는 내장 UI 전용이므로 공개 계약에서 제외합니다.",
  },
  servers: [
    { url: "/imgym", description: "현재 호스트의 imgym basePath" },
    { url: "https://dev.margins.cloud/imgym", description: "운영 서버" },
  ],
  tags: [
    { name: "System", description: "서비스 상태" },
    { name: "Inspect", description: "입력 파일 사전 검사" },
    { name: "Build", description: "여러 산출물을 묶은 배포 팩" },
    { name: "Optimize", description: "기존 포맷 정리와 최적화" },
    { name: "Convert", description: "다른 결과 포맷으로 변환" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["System"],
        operationId: "getHealth",
        summary: "서비스 상태 확인",
        security: [],
        responses: {
          "200": {
            description: "서비스 준비 완료",
            headers: { "Cache-Control": commonHeaders["Cache-Control"] },
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
          },
          "503": {
            description: "서버 API 키 설정 오류",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Unhealthy" } } },
          },
        },
      },
    },
    "/api/v1/inspect-assets": {
      post: {
        tags: ["Inspect"],
        operationId: "inspectAssets",
        summary: "이미지 사전 검사",
        security: bearerSecurity,
        requestBody: multipart({
          images: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: file("정적 PNG, JPEG 또는 WebP"),
          },
        }, ["images"]),
        responses: {
          "200": {
            description: "파일별 검사 결과",
            headers: commonHeaders,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AssetInspectionResponse" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/web-assets": {
      post: {
        tags: ["Build"],
        operationId: "createWebAssetPack",
        summary: "웹 에셋 팩 생성",
        security: bearerSecurity,
        requestBody: multipart({
          images: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: file("정적 PNG, JPEG 또는 WebP"),
          },
          options: jsonString(
            "WebAssetOptions를 JSON 직렬화한 문자열",
            '{"profile":"devices","targetSize":"original","crop":null,"sizes":"(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px","contentHint":"auto","colorPolicy":"preserve","altKind":"informative","altText":"Mountain at sunset","loading":"lazy","includeWebp":true,"includeAvif":true,"includePlaceholder":true}',
          ),
        }, ["images", "options"]),
        responses: {
          "200": {
            description: "이미지, 코드와 manifest.json을 담은 ZIP",
            headers: commonHeaders,
            content: { "application/zip": { schema: { type: "string", format: "binary" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/asset-recipes": {
      post: {
        tags: ["Build"],
        operationId: "createAssetRecipe",
        summary: "에셋 레시피 실행",
        security: bearerSecurity,
        requestBody: multipart({
          asset: file("레시피에 맞는 이미지 또는 HEIC"),
          options: jsonString(
            "frame, icons, palette, social, heic, background, watermark 중 하나",
            '{"recipe":"icons","background":"#ffffff","padding":12,"includeNative":false}',
          ),
        }, ["asset", "options"]),
        responses: {
          "200": {
            description: "산출물과 manifest.json을 담은 ZIP",
            headers: commonHeaders,
            content: { "application/zip": { schema: { type: "string", format: "binary" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/media-recipes": {
      post: {
        tags: ["Build"],
        operationId: "createMediaRecipe",
        summary: "미디어 레시피 실행",
        security: bearerSecurity,
        requestBody: multipart({
          asset: file("GIF 또는 TTF/OTF/TTC/WOFF/WOFF2"),
          options: jsonString(
            "gif-video 또는 font 레시피",
            '{"recipe":"gif-video","background":"#ffffff"}',
          ),
        }, ["asset", "options"]),
        responses: {
          "200": {
            description: "웹 영상 세트 또는 글꼴 서브셋 ZIP",
            headers: commonHeaders,
            content: { "application/zip": { schema: { type: "string", format: "binary" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/optimize-raster": {
      post: {
        tags: ["Optimize"],
        operationId: "optimizeRaster",
        summary: "래스터 이미지 최적화",
        security: bearerSecurity,
        requestBody: multipart({
          image: file("정적 PNG, JPEG 또는 WebP"),
          options: jsonString(
            "OptimizeRasterOptions를 JSON 직렬화한 문자열",
            '{"crop":{"x":0,"y":0,"width":1,"height":1},"resize":{"maxWidth":1600},"mode":"auto","optimization":{"policy":"standard"}}',
          ),
        }, ["image", "options"]),
        responses: {
          "200": {
            description: "입력과 같은 포맷의 최적화된 이미지",
            headers: commonHeaders,
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/vectorize": {
      post: {
        tags: ["Convert"],
        operationId: "vectorizeImage",
        summary: "래스터를 SVG로 변환",
        security: bearerSecurity,
        requestBody: multipart({
          image: file("정적 PNG, JPEG 또는 WebP"),
          preset: { type: "string", enum: ["accurate", "balanced", "tiny", "auto"] },
          cleanup: jsonString(
            "수동 프리셋 전용 VectorCleanupOptionsV1. auto에서는 보내지 않습니다.",
            '{"version":1,"cleanup":2,"colors":64}',
          ),
        }, ["image", "preset"]),
        responses: {
          "200": {
            description: "SVG와 입출력·품질·복잡도 측정값",
            headers: commonHeaders,
            content: { "application/json": { schema: { $ref: "#/components/schemas/VectorizeResult" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/optimize-svg": {
      post: {
        tags: ["Optimize"],
        operationId: "optimizeSvg",
        summary: "SVG 정리 및 최적화",
        security: bearerSecurity,
        requestBody: multipart({
          image: file("최대 2 MiB의 SVG"),
          precision: { type: "integer", enum: [2, 3, 4], default: 3 },
        }, ["image"]),
        responses: {
          "200": {
            description: "안전하게 정리한 SVG와 최적화 통계",
            headers: commonHeaders,
            content: { "application/json": { schema: { $ref: "#/components/schemas/DirectSvgResult" } } },
          },
          ...protectedErrors,
        },
      },
    },
    "/api/v1/docs-to-pdf": {
      post: {
        tags: ["Convert"],
        operationId: "convertDocumentToPdf",
        summary: "Markdown을 PDF로 변환",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  document: file("UTF-8 .md, .markdown 또는 .txt"),
                  markdown: { type: "string", maxLength: 1048576 },
                  options: jsonString(
                    "DocumentPdfOptions를 JSON 직렬화한 문자열",
                    '{"title":"Product guide","lang":"en","pageSize":"a4","orientation":"portrait","template":"document","includePageNumbers":true}',
                  ),
                },
                oneOf: [{ required: ["document"] }, { required: ["markdown"] }],
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "태그가 포함된 PDF/UA-1",
            headers: commonHeaders,
            content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
          },
          ...protectedErrors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "서버의 OHMYIMG_API_KEY와 동일한 개인 운영 키",
      },
    },
    schemas: {
      Health: {
        type: "object",
        properties: { status: { type: "string", const: "healthy" } },
        required: ["status"],
        additionalProperties: false,
      },
      Unhealthy: {
        type: "object",
        properties: { status: { type: "string", const: "unhealthy" } },
        required: ["status"],
        additionalProperties: false,
      },
      ApiError: {
        type: "object",
        properties: {
          error: { type: "string" },
          requestId: { type: "string", format: "uuid" },
        },
        required: ["error"],
      },
      AssetInspectionResponse: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                status: { type: "string", enum: ["ready", "failed"] },
                facts: { type: "object", additionalProperties: true },
                sourceName: { type: "string" },
                error: { type: "string" },
              },
              required: ["index", "status"],
            },
          },
        },
        required: ["items"],
      },
      VectorizeResult: {
        type: "object",
        properties: {
          svg: { type: "string" },
          downloadName: { type: "string" },
          input: { type: "object", additionalProperties: true },
          output: { type: "object", additionalProperties: true },
          timing: { type: "object", additionalProperties: true },
          selection: { type: "object", additionalProperties: true },
          stats: { type: "object", additionalProperties: true },
        },
        required: ["svg", "downloadName", "input", "output", "timing", "selection", "stats"],
      },
      DirectSvgResult: {
        type: "object",
        properties: {
          svg: { type: "string" },
          downloadName: { type: "string" },
          input: { type: "object", additionalProperties: true },
          output: { type: "object", additionalProperties: true },
          safety: { type: "object", additionalProperties: true },
          stats: { type: "object", additionalProperties: true },
        },
        required: ["svg", "downloadName", "input", "output", "safety", "stats"],
      },
    },
  },
} as const;
