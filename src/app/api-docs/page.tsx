import type { Metadata } from "next";
import { ApiReference } from "@/components/api-reference";

export const metadata: Metadata = {
  title: "API Reference · Oh My Img!",
  description: "Oh My Img! 이미지·에셋·문서 변환 API의 요청, 응답, 제한과 curl 예시입니다.",
};

export default function ApiDocsPage() {
  return <ApiReference />;
}
