export function authenticatedApiFetch(
  input: RequestInfo | URL,
  apiKey: string,
  init: RequestInit,
) {
  if (!apiKey) throw new Error("API 키가 필요합니다.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  return fetch(input, { ...init, headers });
}

const API_ERROR_MESSAGES: Record<string, string> = {
  "Unsupported image": "지원하지 않는 이미지입니다.",
  "Animated images are not supported": "움직이는 이미지는 지원하지 않습니다.",
  "Unsupported document": "지원하지 않는 문서입니다.",
  "File is too large": "파일 용량이 너무 큽니다.",
  "Invalid request": "요청 형식이 올바르지 않습니다.",
  "Unauthorized.": "API 키가 올바르지 않습니다.",
  "Service unavailable.": "현재 서비스를 사용할 수 없습니다.",
  "Server is busy. Try again later.": "서버가 처리 중입니다. 잠시 후 다시 시도하세요.",
  "Conversion failed.": "변환 중 오류가 발생했습니다.",
  "Image processing failed.": "이미지 처리 중 오류가 발생했습니다.",
  "Document conversion failed.": "PDF 변환 중 오류가 발생했습니다.",
};

export function koreanApiError(message: string | undefined, fallback: string) {
  return message ? API_ERROR_MESSAGES[message] ?? fallback : fallback;
}
