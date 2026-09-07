# Workflows and API

## Shared HTTP contract

- Public prefix: `/imgym` in every deployed URL.
- Conversion method: `POST` with `multipart/form-data`.
- Authentication: `Authorization: Bearer <OHMYIMG_API_KEY>`.
- Runtime: Node.js Route Handlers, never Edge.
- Cache policy: `Cache-Control: no-store`.
- Admission: one active conversion per process by default; 429 includes `Retry-After: 1`.
- Diagnostics: responses carry `X-Request-Id`; internal native-process detail stays in server logs.

Common statuses are 400 invalid input, 401 bad/missing request key, 413 size limit, 422 valid request with no valid recipe result, 429 busy, 500 processing failure, and 503 invalid server key configuration.

## Workspace map

| UI workspace | Route(s) | Core owner | Output |
| --- | --- | --- | --- |
| Web Asset Pack | `inspect-assets`, `web-assets`, `web-assets/preview` | `src/lib/web-assets/` | JSON inspection, preview image, streamed ZIP |
| Asset Recipes | `asset-recipes`, `asset-recipes/preview`, `media-recipes`, `optimize-svg` | `src/lib/asset-recipes/`, `src/lib/vector/direct-svg.ts` | Preview image, JSON SVG result, streamed ZIP |
| Raster Optimize | `optimize-raster` | `src/lib/raster/` | Same-format image |
| Make SVG | `vectorize` | `src/lib/vector/` | JSON containing hardened SVG, metrics, and stats |
| Document to PDF | `docs-to-pdf` | `src/lib/document/` | PDF/UA-1 |

The browser batch controller accepts up to 10 static images and 50 MiB total, then calls the single-file raster/vector APIs sequentially. Partial success is browser-owned; the server does not expose a general asynchronous batch job.

## Route reference

The table names multipart fields, not JSON body properties. JSON-valued fields are sent as strings inside multipart forms.

| Route after `/imgym/api/v1/` | Fields | Important limit | Response |
| --- | --- | --- | --- |
| `inspect-assets` | repeated `images` | 10 files, 10 MiB each, 50 MiB total | inspection JSON |
| `web-assets` | repeated `images`, `options` JSON | same input limits; ZIP max 260 entries / 128 MiB uncompressed | `web-assets.zip` |
| `web-assets/preview` | one `images`, `options` JSON | one static image | representative image |
| `asset-recipes` | one `asset`, `options` JSON | 20 MiB source | recipe ZIP |
| `asset-recipes/preview` | one `asset`, `options` JSON | 20 MiB source; recipe must have image output | representative image |
| `media-recipes` | one `asset`, `options` JSON | 20 MiB source | media/font ZIP |
| `optimize-raster` | one `image`, `options` JSON | 10 MiB, 8,192 px/side, 25 MP | PNG, JPEG, or WebP matching input format |
| `vectorize` | one `image`, `preset`, optional `cleanup` JSON | 10 MiB, 8,192 px/side, 40 MP, static only | JSON SVG result |
| `optimize-svg` | one `image`, optional `precision` | 2 MiB, 50,000 elements | JSON direct-SVG result |
| `docs-to-pdf` | exactly one `markdown` text or `document` file, optional `options` JSON | 1 MiB Markdown, 100 pages, 24 MiB PDF | PDF |

For complete field schemas and curl examples, use [External API Access Design](../external-api-access-design.md). The route code remains authoritative.

## Web Asset Pack

Pipeline:

```text
signature inspection -> EXIF display dimensions -> content/color/metadata facts
-> requested profile and widths -> fallback + gated WebP/AVIF candidates
-> snippet + optional LQIP + deterministic manifest -> streamed ZIP
```

Profiles:

- `html`: responsive `<picture>` with `srcset`, `sizes`, dimensions, loading intent, and confirmed alternative text.
- `next`: one optimized source, optional `blurDataURL`, and Next.js `<Image>` code; it avoids duplicating Next's runtime variants.
- `design`: bounded 1x/2x/3x exports and a handoff record.

The manifest records source/output SHA-256 values, metadata facts, quality scores, pruning reasons, per-file failures, generated code paths, and recipe version. ICC and CICP are treated independently. The `srgb` policy performs a real ICC source-to-sRGB transform and rejects unsafe CICP-only conversion rather than relabeling pixels.

## Asset Recipes

| Recipe | Scope |
| --- | --- |
| `frame` | Focus-aware crops for 1:1, 4:3, 3:2, 16:9, 2:1, and 9:16; optional rotate, flip, trim, pad. |
| `icons` | Favicon, PWA, Apple, maskable, monochrome; optional iOS/Android handoff files. |
| `palette` | 3–8 colors, CSS/JSON, WCAG ratios, selected-background comparisons, swatch, LQIP. |
| `social` | Fixed 1200×630 OG output, title/subtitle, mandatory human alt, markup and Next.js names. |
| `heic` | First-frame SDR 8-bit HEIC to JPEG/WebP; HDR and unsupported structure are rejected. |
| `background` | Solid-color similarity removal only; explicitly not AI segmentation. |
| `watermark` | Bounded text, color, opacity, and five positions. |
| `gif-video` | At most 30 seconds / 30 fps; muted-loop VP9 WebM, H.264 MP4, poster PNG, HTML. |
| `font` | TTF/OTF/TTC/WOFF/WOFF2 to WOFF2 subset, CSS Unicode range, rights receipt; explicit license confirmation required. |

Each ZIP includes a versioned manifest. This manifest is the DAM/CDN handoff boundary; the server itself stores nothing.

## Raster optimization

```text
validate -> EXIF auto-orient -> normalized crop -> optional no-upscale resize
-> manual preset or bounded Auto candidates -> decode and measure -> same-format output
```

Manual modes are `high`, `balanced`, and `small`. `auto` evaluates only server-owned candidate families and returns the smallest output that passes the versioned SSIM, pixel-MAE, edge-MAE, and alpha-MAE gates. `standard` is the conservative family; `smaller` opts into additional bounded candidates. Animated PNG and WebP are rejected.

## Vector workflows

Raster vectorization:

```text
validate static raster -> optional no-dither cleanup -> VTracer
-> conservative SVGO -> SVG analysis -> JSON result
```

Modes are `accurate`, `balanced`, `tiny`, and `auto`. Auto evaluates six bounded tracing/optimization candidates, rasterizes with librsvg, applies SSIM/MAE/edge-MAE plus complexity gates, and chooses the smallest passing SVG. Auto intentionally does not combine with user cleanup until a cleaned-reference comparison is implemented.

Direct SVG optimization preserves titles, descriptions, self-contained safe CSS, gradients, dimensions, markers, and internal fragments. It removes scripts, events, embedded images, `foreignObject`, unsafe/external CSS, and external references. It rejects DOCTYPE/ENTITY input and never injects uploaded markup into the browser DOM.

## Document PDF

```text
UTF-8 Markdown -> Markdown-it semantic HTML -> fixed paged stylesheet
-> isolated Python process -> WeasyPrint PDF/UA-1 -> bounded PDF
```

Supported source files are `.md`, `.markdown`, and `.txt`. Page options are A4/Letter, portrait/landscape, Korean/English, document/resume template, and page numbers. Raw HTML, user CSS, JavaScript, remote images, arbitrary local files, and DOCX are non-goals for the current version.
