# Copy-Safe Resume

한국어, English, 숫자 1234, 기호를 포함한 문서의 복사 순서를 검증합니다.

## Profile

Semantic source order is the reading order. The generated PDF must contain live, searchable text rather than a raster screenshot or an invisible OCR overlay.

## Core principles

- Headings stay with the first block that follows them.
- Short list items move as one pagination unit.
- Table headers repeat, while each ordinary row stays together.
- Long paragraphs use widows and orphans instead of shrinking the font.

## Experience

### Project Alpha

Built a public service interface with accessible components, predictable state management, and documented API contracts. The work included design-system components, keyboard behavior, responsive layouts, integration tests, and production support.

### Project Beta

Maintained an education platform and improved shared frontend modules. The project included data fetching, reusable forms, error boundaries, performance analysis, and operational documentation.

## Detailed notes

This paragraph intentionally contains enough text to exercise normal line wrapping and pagination. A PDF viewer must be able to select the sentence as real Unicode text. When the paragraph reaches a page boundary, the renderer should keep at least three shaped lines on both sides whenever the available page space permits it. The source remains one semantic paragraph, and the output must not substitute a page image for the text layer.

This second paragraph repeats the pagination pressure with different words. Reliable copy behavior depends on semantic HTML, embedded fonts, Unicode mappings, and a single DOM reading order. Visual columns, absolute coordinates, canvas snapshots, and post-hoc invisible OCR layers are deliberately absent from the pipeline.

This third paragraph provides additional page pressure. The implementation should remain deterministic under the pinned renderer version, fixed stylesheet, fixed page dimensions, and fixed font family. Renderer upgrades require the same extraction and visual checks rather than an assumption that a green build proves unchanged pages.

This fourth paragraph provides additional page pressure. The implementation should remain deterministic under the pinned renderer version, fixed stylesheet, fixed page dimensions, and fixed font family. Renderer upgrades require the same extraction and visual checks rather than an assumption that a green build proves unchanged pages.

This fifth paragraph provides additional page pressure. The implementation should remain deterministic under the pinned renderer version, fixed stylesheet, fixed page dimensions, and fixed font family. Renderer upgrades require the same extraction and visual checks rather than an assumption that a green build proves unchanged pages.

This sixth paragraph provides additional page pressure. The implementation should remain deterministic under the pinned renderer version, fixed stylesheet, fixed page dimensions, and fixed font family. Renderer upgrades require the same extraction and visual checks rather than an assumption that a green build proves unchanged pages.

## HEADING_KEEP_MARKER

HEADING_BODY_MARKER must appear on the same page as the heading immediately above it.

## Skills table

| Marker | Period | Role and evidence |
| --- | --- | --- |
| ROW_01_START ROW_01_END | 2022–2023 | Built semantic document processing and maintained production services. |
| ROW_02_START ROW_02_END | 2023–2024 | Implemented accessible frontend components and API integrations. |
| ROW_03_START ROW_03_END | 2024–2025 | Reviewed code, automated tests, and improved deployment checks. |
| ROW_04_START ROW_04_END | 2025–2026 | Added copy-safe PDF output with real table semantics and Unicode text. |
| ROW_05_START ROW_05_END | 2026–Now | Verified tagged structure, embedded fonts, extraction order, and visual pages. |

## Closing

The end marker confirms that content after the table remains in the expected reading order.

DOCUMENT_END_MARKER
