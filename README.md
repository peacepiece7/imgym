# Oh My Img!

A small, self-hosted conversion tool with three independent workflows:

- crop, resize, and same-format optimize static PNG, JPEG, and WebP images;
- vectorize PNG, JPEG, and WebP images with no-dither raster cleanup, VTracer, and SVGO;
- convert semantic UTF-8 Markdown into tagged, selectable PDF/UA documents.

The image workflows accept up to ten files (50 MiB total in the browser) and process them sequentially through the existing one-file requests. Raster crops are stored per file, results may succeed or fail independently, and no upload or output is permanently stored.

Every conversion request requires the single owner API key configured in `OHMYIMG_API_KEY`. The key is verified independently on every request; there is no login session or key-issuance endpoint.

## Pipelines

```text
Raster R1
upload -> validate -> EXIF auto-orient -> crop -> fit resize -> encode -> preview/download

Raster R2 Auto
R1 transforms -> fixed encoder candidates -> decode -> SSIM + MAE gates -> smallest passing image

SVG V1
upload -> validate -> VTracer -> conservative SVGO -> analyze -> preview/download

SVG V2 Auto
upload -> 6 VTracer/SVGO candidates -> librsvg rasterize -> SSIM + MAE + edge-MAE gates -> smallest passing SVG

Document PDF V1
Markdown -> semantic HTML -> paged-media layout -> WeasyPrint PDF/UA-1 -> preview/download
```

Raster output keeps the input format. Animated PNG and WebP are intentionally rejected by both raster and vector workflows. Auto mode searches only four PNG or seven JPEG/WebP candidates; it returns no result when even the High baseline fails the quality gates.

## Requirements

- Node.js 24 LTS
- pnpm 10.7.1
- ImageMagick 7 with PNG, JPEG, and WebP read/write support
- `rsvg-convert` (librsvg) for SVG V2 similarity rendering
- Python 3, WeasyPrint 68.1, and a Korean-capable Noto CJK font for document PDF output
- Poppler (`pdfinfo`, `pdffonts`, and `pdftotext`) for the document integration tests

On macOS with Homebrew:

```sh
brew install imagemagick librsvg poppler
python3 -m venv .venv
.venv/bin/pip install weasyprint==68.1
magick -version
magick -list format | grep -E '^\s+(JPEG|PNG|WEBP)'
rsvg-convert --version
```

The document renderer automatically prefers `.venv/bin/python3` (or `.venv\\Scripts\\python.exe` on Windows) so its pinned WeasyPrint installation does not depend on whichever Python happens to appear first on `PATH`. Set `DOCUMENT_PDF_PYTHON_BINARY` to an absolute interpreter path only when a different managed environment is intentional.

ImageMagick is needed for raster optimization and SVG quality measurement. The Docker builder and runtime install the Alpine JPEG/WebP modules and `rsvg-convert` explicitly so the canonical build runs both raster and SVG Auto regressions before producing the final image.

## Run locally

Generate one key and save it in the ignored root `.env` file:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

```dotenv
OHMYIMG_API_KEY=replace-with-the-generated-value
```

Then start the application:

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The masked API-key field uses `localStorage.ohmyimgapikey` as its default, persists edits under that key, and attaches the value to each raster, vector, and document API call. This convenience is intended only for the owner's private browser profile.

## Commands

```sh
pnpm dev          # development server
pnpm lint         # ESLint
pnpm test         # unit, process-integration, and route tests
pnpm build        # production build
pnpm start        # production server after a build
pnpm calibrate    # create raster/vector corpus reports against a running server
```

## Docker

```sh
docker build -t oh-my-img .
docker run --rm --env-file .env -p 3000:3000 oh-my-img
```

The production image uses Node 24, Next.js standalone output, ImageMagick 7, WeasyPrint 68.1, Noto CJK fonts, and a non-root user. `.env*` is excluded from the Docker build context; the key is injected only at runtime. `/api/health` is the public container readiness check and returns 503 when the mandatory key configuration is absent or invalid.

## External API authentication

The canonical conversion endpoints are:

```text
POST /api/v1/optimize-raster
POST /api/v1/vectorize
POST /api/v1/docs-to-pdf
```

Every call must include:

```http
Authorization: Bearer <OHMYIMG_API_KEY>
```

Missing or incorrect request credentials return 401 before multipart parsing. Missing or invalid server configuration returns 503. The previous unversioned conversion paths were removed. See [the external API access design](./docs/external-api-access-design.md) for the multipart contracts and `curl` examples.

## Raster behavior

Manual presets are format-specific and centralized in `src/lib/raster/presets.ts`:

- **High** preserves more encoded detail.
- **Balanced** is the default quality/size trade-off.
- **Small** prefers fewer bytes.
- **Auto** selects the smallest candidate that passes the versioned SSIM and MAE gates.

Auto also offers a shared **Standard / Smaller** policy. Standard preserves the previous bounded candidate family. Smaller opts into at most 10–12 server-owned candidates: lossless strategy and palette PNG, optimized/progressive JPEG, or sharp-YUV/filtered WebP. The browser never sends raw codec arguments. Every lossy Auto candidate must also pass edge and alpha guards, and Standard remains the fallback.

Crop coordinates are normalized ratios in the browser's EXIF-corrected display space. The server always runs `auto-orient -> crop -> optional no-upscale resize -> encode` in that order. Processing uses `child_process.spawn()` with `shell: false`, fixed resource limits, bounded stdout/stderr, a 35-second per-child timeout, and an isolated temporary directory. On the Linux production target, ImageMagick and its delegates share a process group so cancellation terminates the whole tree. Raster and SVG Auto searches also have a 90-second whole-search deadline; request cancellation stops active ImageMagick work and prevents later candidates from starting.

Raster limits:

- 10 MiB encoded upload
- 8,192 px maximum width or height
- 25 megapixels decoded area
- 32 MiB output cap
- static PNG, JPEG, and WebP only

Expected validation errors are short. Internal ImageMagick failures return only `Image processing failed.` and a request ID; full bounded diagnostics remain in server logs.

## SVG behavior

- **Accurate** keeps more colors and coordinate precision.
- **Balanced** is the default quality/size trade-off.
- **Tiny** reduces colors and curve detail more aggressively.
- **Auto** evaluates six bounded VTracer/SVGO configurations and selects the smallest result that passes the versioned SSIM, pixel-MAE, edge-MAE, and complexity gates.

The report keeps visual similarity, serialized SVG size, and SVG complexity as separate concerns. Manual SVG presets add Cleanup and Colors controls before tracing; Advanced exposes bounded speckle, alpha, gradient, color-precision, and curve-simplification values. Palette reduction disables dithering so it does not manufacture tiny vector regions. SVG Auto currently retains its original-raster quality reference and therefore leaves cleanup disabled until cleaned-reference search is implemented. Its thresholds are starting values pending corpus calibration, not a universal quality claim.

## Document PDF behavior

Docs to PDF accepts pasted Markdown or UTF-8 `.md`, `.markdown`, and `.txt` files. GFM headings, paragraphs, lists, tables, links, quotes, and code become real semantic HTML elements before WeasyPrint creates PDF/UA-1 output. The UI supports A4/Letter, portrait/landscape, document/resume templates, page numbers, browser preview, and download.

The fixed print stylesheet keeps headings with their first following block, applies three-line widow/orphan protection to paragraphs, moves short list items and table rows as units, and repeats table headers. Source DOM order is the PDF reading order. Raw HTML, user CSS, JavaScript, remote images, arbitrary files, and DOCX are not accepted in V1. The Python renderer is spawned without a shell, cannot fetch external resources, receives no API key, and returns only bounded PDF bytes.

## Design and research

See [the vectorization design](./docs/image-optimization-design.md) for the tracer comparison, paper findings, SVG V2 bounded search, and SVG V3 simplification research. See [the vector cleanup design](./docs/vector-cleanup-design.md) for preprocessing controls, option ownership, and the cleaned-reference Auto roadmap. See [the raster design and implementation record](./docs/raster-crop-and-optimization-design.md) for crop semantics, ImageMagick process safety, encoder presets, verification, and Raster R2/R3 quality gates. See [the multi-image upload design](./docs/multi-image-upload-design.md) for the sequential browser queue, per-file raster crops, partial success, limits, and download plan. See [the document-to-PDF design](./docs/document-to-pdf-design.md) for the copy contract, PDF/UA structure, pagination rules, security boundary, and verification plan.

The latest correctness and verification findings are recorded in [the implementation review](./docs/implementation-review-2026-08-23.md). Mandatory per-request owner-key protection and versioned external conversion endpoints are specified and recorded in [the external API access design](./docs/external-api-access-design.md).
