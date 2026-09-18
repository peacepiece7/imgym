import { FileText, ImagePlus, LayoutGrid, PenTool, type LucideIcon } from "lucide-react";

export type Tool = "web-assets" | "recipes" | "vector" | "document";

export interface ToolMeta {
  id: Tool;
  /** Sidebar entry: what the tool is called now, plus the one line that makes it pickable. */
  label: string;
  summary: string;
  icon: LucideIcon;
  /** Main-column header for the tool. */
  heading: string;
  description: string;
  /** Revealed by "이 작업 설명 보기". */
  help: string[];
}

export const TOOLS: readonly ToolMeta[] = [
  {
    id: "web-assets",
    label: "이미지 만들기",
    summary: "자르기 · 기기별 포맷 · 용량 줄이기",
    icon: ImagePlus,
    heading: "이미지 만들기",
    description: "올린 이미지를 필요한 부분만 남기고, 기기별 파일 또는 한 장으로 만든 뒤 압축 파일 하나로 내려받습니다.",
    help: [
      "이미지를 올리면 실제 형식과 크기, 안에 든 정보를 먼저 확인합니다.",
      "남길 부분만 끌어서 자릅니다. 그대로 두면 전체를 씁니다.",
      "‘기기별 포맷 생성’과 ‘원본 한 장’ 중 하나만 고르면 나머지는 자동으로 정해집니다.",
      "만든 결과를 원본과 비교해 눈에 띄는 차이가 없는지 확인합니다.",
      "파일과 붙여넣을 코드를 압축 파일 하나로 받습니다. 서버에는 남지 않습니다.",
    ],
  },
  {
    id: "recipes",
    label: "자주 쓰는 변환 모음",
    summary: "썸네일·아이콘·OG 이미지·워터마크",
    icon: LayoutGrid,
    heading: "자주 쓰는 변환 모음",
    description: "썸네일, 아이콘, 공유용 이미지처럼 자주 만드는 결과를 한 번에 만듭니다.",
    help: [
      "만들려는 결과를 고르면 크기와 형식이 함께 정해집니다.",
      "여러 이미지를 한 번에 올려 같은 설정으로 처리할 수 있습니다.",
    ],
  },
  {
    id: "vector",
    label: "그림을 선 그래픽으로",
    summary: "사진 → SVG 변환 · SVG 정리",
    icon: PenTool,
    heading: "그림을 선 그래픽으로",
    description: "로고나 단순한 그림을 크기를 키워도 깨지지 않는 SVG로 바꾸고, 이미 있는 SVG는 정리합니다.",
    help: [
      "색이 단순하고 경계가 뚜렷한 그림일수록 결과가 좋습니다.",
      "이미 SVG라면 변환 대신 불필요한 부분만 정리합니다.",
    ],
  },
  {
    id: "document",
    label: "글을 PDF 문서로",
    summary: "Markdown → 읽기 쉬운 PDF",
    icon: FileText,
    heading: "글을 PDF 문서로",
    description: "Markdown으로 쓴 글을 제목과 목차가 살아 있는 PDF로 만듭니다.",
    help: [
      "제목 단계가 그대로 PDF의 목차가 됩니다.",
      "화면 낭독기로도 읽을 수 있도록 구조를 남겨 저장합니다.",
    ],
  },
];

export function toolMeta(id: Tool) {
  return TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];
}
