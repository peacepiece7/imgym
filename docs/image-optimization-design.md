# OhMyImg / OhMySVG: Vectorization and Optimization Design

Status: SVG V1/V2, Raster R1/R2, and vector-cleanup Phase A implemented; cleanup calibration and SVG V3 remain  
Updated: 2026-08-27  
Scope: PNG/JPEG/WebP to SVG, image cropping, raster optimization, and SVG optimization

## 1. Decision

The recommended V1 is a small, self-hosted Next.js application using VTracer's official Node.js WASM package directly:

```text
PNG / JPEG / WebP
        |
        v
Next.js validation and HTTP handling
        |
        v
@visioncortex/vtracer.convertBuffer() -> raw SVG
        |
        v
SVGO -> optimized SVG
        |
        v
preview, statistics, download
```

Use VTracer as the only vectorization engine in V1. Keep Potrace as an optional black-and-white benchmark and ImageTracerJS as a browser experiment, not as V1 dependencies. Do not implement a tracing algorithm or add AI/ML in V1.

The official package performs image decoding and vectorization in WASM and accepts an encoded buffer without temporary files or native dependencies. Next.js owns validation, preset mapping, SVGO, result analysis, preview, and download.

Do not add Python to V1. A Python CLI remains a fallback only if later work actually reuses svgsmith, Pillow, or Python-only metrics, or if measured inputs prove that process isolation is necessary. V1 must not implement both integrations.

### 1.1 The primary quality rule

Compression ratio alone is not the goal. Every result must be evaluated on three independent axes:

1. **Visual Similarity**: how closely the rendered SVG matches the raster.
2. **SVG Size**: serialized downloadable bytes. Gzip bytes are an optional offline transport diagnostic, not the production selection objective.
3. **SVG Complexity**: path, command, element, and color counts.

For example:

```text
Result A                         Result B
Similarity  99.8%               Similarity  99.4%
Size        180 KB               Size         71 KB
Paths       420                  Paths        126
```

Result B may be more useful even though A has a slightly higher similarity score. No single metric should decide quality. SVG V1 reports size and complexity; SVG V2 adds similarity and searches for the smallest acceptable SVG under explicit quality and complexity limits.

## 2. Scope and non-goals

This is a personal tool running on the owner's local or private server. It has no database, permanent upload storage, multi-user queue, or key-issuance system. Mandatory per-request authentication with one environment-configured key is implemented and recorded separately in [External API Access Design](./external-api-access-design.md). Dependency licensing is not an architecture criterion for this personal-only build; re-check dependencies only if distribution or commercial use is introduced later.

"Raster to SVG" means approximating pixels with editable vector primitives such as `path`, `rect`, `circle`, and `g`. Wrapping the bitmap in an SVG `<image>` element is not vectorization and does not improve scaling or file size.

The full product has four capabilities:

- PNG/JPEG/WebP to editable SVG
- image cropper
- raster image optimization
- SVG optimization

They were delivered in stages. V1 established basic vectorization, Raster R1/R2 added crop and raster encoding, and SVG V2 added bounded automatic selection. The next vector increment is the explicit raster-cleanup stage specified in [Raster Cleanup and Vector Path Cleanup Design](./vector-cleanup-design.md).

## 3. Evidence reviewed

### 3.1 Local repositories

| Project | Revision | Relevant capability | Decision |
|---|---:|---|---|
| ImageMagick | `86e0ac658529` | crop, resize, orientation, metadata, raster codecs | Use after V1 for crop/raster optimization |
| Oh My SVG | `cc9fb4cf7bb1` | preview and SVGO option UX | Use as a UX reference |
| SVGO | `d55270ce17b9` (`4.0.2`) | SVG AST optimization | Use in V1 |
| svgsmith | `6206b096dfcf` | classification, multiple tracers, SSIM verification | Use as a benchmark/reference, not as the whole V1 runtime |

The existing svgsmith `classify -> preprocess -> trace -> postprocess -> verify` flow is useful evidence for SVG V2. Copying its Python runtime, classification, metric, and fallback machinery into SVG V1 would defeat the staged plan.

### 3.2 Papers

Stored originals:

- [Image Vectorization: a Review](./papers/2306.06441-image-vectorization-review.pdf), arXiv:2306.06441v1, 2023
- [Towards Layer-wise Image Vectorization](./papers/ma-2022-layer-wise-image-vectorization.pdf), CVPR 2022

| Paper | Original source | Pages | Stored SHA-256 |
|---|---|---:|---|
| Image Vectorization: a Review | <https://arxiv.org/html/2306.06441v1> | 16 | `bb8ac95e3f70f0d6c7cb34a20bebd919af29b83d1cb4d609e4ff6939f2d13c32` |
| Towards Layer-wise Image Vectorization | <https://openaccess.thecvf.com/content/CVPR2022/papers/Ma_Towards_Layer-Wise_Image_Vectorization_CVPR_2022_paper.pdf> | 10 | `3adf90d18e5ecc6134e3561ab6b5559fd5b416c39d3c58edeb1234fa745ae047` |

The review evaluates fidelity, complexity, speed, generality, and user control. Its main lesson is that quality, path/segment count, runtime, and controllability trade off against one another. VTracer is fast but may create many paths; iterative differentiable methods can use fewer paths but are much slower.

LIVE adds closed cubic Bezier paths layer by layer, placing new shapes in poorly reconstructed components. Its contour-aware UDF loss, self-intersection penalty, and coarse-to-fine strategy are useful ideas for later local refinement. LIVE is not a suitable V1 engine: it is iterative, expensive, lacks a universal automatic shape-count choice, and is not a general solution for photographs.

DiffVG and differentiable rasterization belong in SVG V3 research, after a deterministic VTracer baseline and benchmark harness exist.

## 4. Vectorizer research

### 4.1 VTracer

The current release reviewed is `1.0.0-alpha.3` from 2026-08-01. Because it is an alpha release and its options changed substantially from 0.6, pin the exact version and keep all package-specific names in one preset module. Relevant official sources are the [VTracer README](https://github.com/visioncortex/vtracer), [Node.js API](https://github.com/visioncortex/vtracer/tree/master/nodejs), and [1.0 changelog](https://github.com/visioncortex/vtracer/blob/master/CHANGELOG.md).

VTracer 1.0 is a staged Rust framework:

```text
encoded image
    -> decode
    -> frontend / region segmentation
    -> color fitting and optional palette quantization
    -> stacked or cutout composition
    -> region outline extraction
    -> pixel, polygon, or spline curve fitting
    -> optional curve simplification
    -> SVG optimization and serialization
```

#### Region and color formation

`clustering: "color-cluster"` groups nearby, similar pixels into flat-color regions. `colorPrecision` controls the significant bits retained per RGB channel; lowering it merges more colors and generally reduces region, color, and path counts at the cost of banding and lost detail. `maxColors` or a fixed `palette` adds a more explicit palette constraint. VTracer 1.0 also offers binary thresholding and hierarchical watershed segmentation for uneven scans or content-following regions.

`hierarchical: "stacked"` draws coarse regions below more detailed regions. `"cutout"` produces a seam-free mosaic using shared boundaries. The choice changes overlap, editability, and serialized geometry and must be benchmarked rather than assumed.

#### Contours and Bezier fitting

Each segmented region supplies a closed boundary. `mode: "pixel"` preserves that boundary, `"polygon"` simplifies it to line segments, and `"spline"` fits smooth curves. Spline fitting identifies corner candidates, subdivides long boundary runs, and splices compatible curve segments. The new `simplify` pass refits smooth runs using fewer cubic curves while keeping the result within a pixel tolerance; corners and shared junctions remain pinned.

Simplification is therefore not merely cosmetic. Fewer cubic segments reduce path-data characters, renderer work, and edit points, but excessive tolerance moves contours and deletes small features.

#### Current option names and effects

The official Node API uses camelCase, the Python binding uses snake_case, and the CLI uses kebab-case. V1 uses only the camelCase column; this table prevents older Python/CLI names from leaking into the Node adapter.

| Concept | Node.js | Python/CLI family | Expected effect when increased |
|---|---|---|---|
| color precision | `colorPrecision` | `color_precision` / `--color-precision` | More color fidelity, usually more regions and bytes |
| coordinate precision | `pathPrecision` | `path_precision` / `--path-precision` | More accurate coordinates and more characters |
| tiny region filter | `filterSpeckle` | `filter_speckle` / `--filter-speckle` | Fewer tiny paths, possible loss of dots/details |
| gradient/layer separation | `layerDifference` | `layer_difference` / `--gradient-step` | Larger separation generally means fewer gradient layers |
| curve simplification | `simplify` | `simplify` / `--simplify` | Fewer cubic segments, greater geometric approximation |
| corner threshold | `cornerThreshold` | `corner_threshold` / hidden `--corner-threshold` | Alters which turns remain corners; higher values generally smooth more |
| subdivision length | `lengthThreshold` | `length_threshold` / hidden `--segment-length` | Alters sampling/fitting density |
| splice threshold | `spliceThreshold` | `splice_threshold` / hidden `--splice-threshold` | Alters when fitted curve runs are split/joined |
| output optimizer | `optimize` | `optimize` / `--optimize` | `0` off, `1` cleanup/quantization, `2` adds shorthand/grouping |

In 1.0, corner, length, and splice controls are deliberately hidden from CLI help because upstream defaults cover most conversions; `simplify` is now the primary size-versus-smoothness control. Do not expose the hidden controls in the initial UI.

### 4.2 Potrace

[Potrace](https://potrace.sourceforge.net/) converts a two-valued bitmap into smooth vector outlines. Its process follows bitmap path decomposition, polygon approximation, corner/curve decisions, Bezier fitting, and optional curve optimization. Important controls include `turdsize` for speckles, `alphamax` for corner behavior, `opttolerance` for curve merging, and `turnpolicy` for ambiguous pixel junctions. The [technical paper](https://potrace.sourceforge.net/potrace.pdf) documents the algorithm.

Potrace remains extremely strong for silhouettes, logos, scans, and line art after thresholding. It is not a color vectorizer and does not produce centerlines. A color workflow would require quantizing and tracing separate layers, duplicating work already handled by VTracer.

Decision: do not add Potrace to V1. Add it only if the fixed black-and-white corpus shows a material fidelity/complexity advantage over VTracer's `bw` mode.

### 4.3 ImageTracerJS

[ImageTracerJS](https://github.com/jankovicsandras/imagetracerjs) is a pure JavaScript tracer usable in a browser or Node.js. Its documented pipeline is:

```text
color quantization
    -> layer separation and edge detection
    -> path scan
    -> interpolation
    -> straight-line or quadratic-spline fitting
    -> SVG serialization
```

Useful controls include `numberofcolors`, `colorquantcycles`, `ltres`, `qtres`, `pathomit`, `roundcoords`, `layering`, and blur settings. It is easy to prototype in a Web Worker and avoids a server round trip.

Its own [process notes](https://github.com/jankovicsandras/imagetracerjs/blob/master/process_overview.md) warn about limited error handling, possible out-of-memory behavior on large images/many layers, empirically chosen defaults, and unfinished fitting ideas. Its latest packaged design is also much older than VTracer 1.0.

Decision: keep it as an optional browser-preview experiment. It should not be a second authoritative V1 engine because that would double preset calibration and make browser/server results inconsistent.

### 4.4 Engine decision matrix

| Engine | Color | Best use | Integration | V1 role |
|---|---|---|---|---|
| VTracer 1.0 | Yes | general color art, scans, pixel art | official Node WASM buffer API | primary V1 engine |
| Potrace | No | binary logo/silhouette/line art | CLI/native wrappers | benchmark only |
| ImageTracerJS | Yes | small browser prototypes | pure JavaScript | experiment only |
| LIVE/DiffVG | Yes | slow research-quality refinement | Python/GPU-oriented | SVG V3 research |

## 5. SVG size and optimization research

The largest contributors to SVG size are usually:

1. Path-data command and coordinate count.
2. Decimal precision and repeated numeric tokens.
3. Number of small elements, each with tag and attribute overhead.
4. Repeated fills, transforms, IDs, groups, styles, and metadata.
5. Embedded raster data, which must not appear in true-vector mode.

Path count correlates with size, but not linearly. One path can contain thousands of commands, while many simple paths can be cheap after gzip. Command count and serialized byte size are more direct measurements. Color count also has an indirect effect: more colors normally create more regions and boundaries, but reducing colors can introduce visible banding, merge semantic parts, and alter antialiased edges.

SVGO 4.0.2 is the postprocessor. `preset-default` can remove metadata/comments, clean numeric values, convert colors, collapse or move attributes, and optimize path data and transforms. It cannot decide whether an important eye, letter, or contour should disappear; that requires rasterized comparison.

V1 uses a conservative profile:

- retain `viewBox`; do not enable `removeViewBox`
- remove metadata, comments, scripts, event handlers, and unused attributes
- optimize colors, transforms, groups, and path syntax through `preset-default`
- start with `floatPrecision: 3`
- do not enable extra aggressive shape/path merging before visual regression exists
- count downloadable raw SVG bytes in production and use them as the SVG V2 objective; gzip size may be recorded by offline calibration when transport behavior is being studied

SVG sanitization is separate from compression. VTracer is the only SVG producer in V1, but preview should still use an object URL in an `<img>` instead of injecting raw markup with `dangerouslySetInnerHTML`.

## 6. Similarity metrics

SVG V1 does not automatically accept or reject output by similarity. It establishes deterministic conversion and records the data needed for SVG V2.

| Metric | Perceptual usefulness | Cost | Node.js difficulty | Best location |
|---|---|---:|---|---|
| Pixel difference / MAE | Poor alone; sensitive to antialiasing and one-pixel shifts | Very low | Easy | browser preview or server |
| PSNR | Cheap large-error signal; weak perceptual ordering | Very low | Easy from MSE | browser or server |
| SSIM / MS-SSIM | Good initial structural metric; can miss color shifts and small features | Low–medium | Moderate | deterministic server; Worker is possible |
| LPIPS | Better learned signal for some natural images; may miss small geometry | High | High due to model/runtime | research server only |

SSIM is the best initial SVG V2 metric, not a complete quality definition. Combine it with:

- edge F-score or edge IoU for contours and text
- mean and p95 Delta E for color error
- alpha checks over white, black, and checkerboard backgrounds
- path/command/element limits
- manual contact-sheet review while thresholds are calibrated

VTracer 1.0's `vtracer-bench` combines PSNR, SSIM, and a clustered missing-patch score. It is worth running as a reference, but OhMySVG should retain the components so one high aggregate number cannot hide a failed axis.

LPIPS is not recommended for the SVG V2 MVP. Its model dependency and compute cost are disproportionate for this tool, and it does not remove the need for edge and color checks.

## 7. Target architecture

### 7.1 Long-term pipeline

```text
Raster image
    -> preprocess
    -> vectorize
    -> SVG optimize
    -> complexity reduce
    -> deterministic rasterize
    -> quality measure
    -> bounded search / optimize
    -> smallest acceptable SVG
```

The optimization problem is:

```text
minimize serialized SVG bytes

subject to:
  visual quality >= calibrated thresholds
  complexity <= configured budgets
  runtime and memory <= configured budgets
```

Complexity is a constraint and tie-breaker, not a substitute for byte size. Keep a small Pareto frontier when one candidate is smaller but another is materially simpler.

### 7.2 V1 runtime and file boundaries

Use Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, pnpm, `@visioncortex/vtracer`, [`image-dimensions`](https://github.com/sindresorhus/image-dimensions), and SVGO. `image-dimensions` is a small zero-dependency header reader used only to enforce format and pixel-count limits before VTracer decodes the image. The upload, drag-and-drop, preset, preview, and download UI is a Client Component. The Route Handler uses the default Node.js runtime; do not use Edge runtime for the Node WASM package.

Initial pins for the implementation spike are VTracer `1.0.0-alpha.3`, SVGO `4.0.2`, and `image-dimensions` `2.5.1`. Pin the Next.js/React versions generated at project creation in `pnpm-lock.yaml`; do not use floating versions in the Docker build.

```text
src/
  app/
    page.tsx
    api/v1/vectorize/route.ts
    api/health/route.ts
  components/
    image-dropzone.tsx
    image-preview.tsx
    vector-settings.tsx
    vector-result.tsx
  lib/vector/
    vtracer.ts
    svgo.ts
    presets.ts
    analyze-svg.ts
    validate-image.ts
    types.ts
```

`route.ts` is only an HTTP adapter. It validates the multipart request, calls the core functions, logs a failed request once, and returns the response. It does not contain VTracer options, SVGO configuration, or error subclasses.

```ts
const vectorized = vectorizeImage(image, options)
const optimized = optimizeSvg(vectorized.svg)
const stats = analyzeSvg(optimized.svg)
```

The page remains a Server Component; only the interactive workspace needs `'use client'`.

### 7.3 Minimal in-process contract

`vectorizeImage` receives a validated `Buffer` and one allowlisted product preset, maps that preset to a camelCase VTracer options object, and calls `convertBuffer`. The returned SVG string is passed directly to SVGO. There are no temporary files, subprocesses, shell commands, or cross-runtime serialization.

```ts
const svg = vtracer.convertBuffer(image, VTRACER_PRESETS[preset])
```

`convertBuffer` is synchronous. V1 accepts this limitation because it is a private single-user tool and strict byte/dimension/pixel limits run first. Do not preemptively add Worker Threads. If the benchmark shows unacceptable event-loop stalls, move only `vectorizeImage` into a Node Worker or external CLI while keeping its public function contract unchanged.

VTracer does not document automatic EXIF-orientation normalization. V1 treats the encoded pixel matrix as the source; orientation normalization moves into the crop/raster preprocessing phase. Include an EXIF-oriented JPEG in the corpus so this limitation remains visible rather than accidental.

### 7.4 Minimal error and logging policy

Keep errors intentionally coarse:

- user-correctable validation may return `Unsupported image` or `File is too large`
- every VTracer, malformed SVG, SVGO, and unexpected internal failure returns `Conversion failed.`
- the UI does not receive stack traces, WASM exception text, or a pipeline-stage taxonomy
- the server writes one structured failure log containing a request ID, elapsed time, and the original caught error

Do not build custom exception hierarchies, per-stage recovery, automatic retries, distributed tracing, persisted job state, or an error dashboard in V1. The request ID is only for finding the matching server log. Real input limits remain the primary protection for synchronous WASM. The Auto deadline cancels surrounding ImageMagick work, checks elapsed time after each synchronous stage, and prevents later candidates, but it cannot interrupt a VTracer call already executing; introduce a Worker or CLI boundary only if measurements justify it.

### 7.5 Internal API

```ts
type VectorizePreset = 'accurate' | 'balanced' | 'tiny'

interface VectorizeOptions {
  preset: VectorizePreset
}

interface VectorizeResult {
  svg: string
  durationMs: number
}

interface OptimizeSvgResult {
  svg: string
  beforeBytes: number
  afterBytes: number
  durationMs: number
}

interface SvgStats {
  paths: number
  commands: number
  elements: number
  colors: number
}

function vectorizeImage(
  image: Buffer,
  options: VectorizeOptions,
): VectorizeResult

function optimizeSvg(svg: string): OptimizeSvgResult

function analyzeSvg(svg: string): SvgStats
```

Analyze SVG from a parsed AST/path representation rather than broad regular expressions. Count fill/stroke values after normalization and document how gradients and `currentColor` are treated. Return only stable statistics.

## 8. V1 — Basic Vectorizer

### 8.1 Functional flow

```text
PNG / JPEG / WebP
    -> header format and dimension validation
    -> VTracer Node WASM preset
    -> raw SVG
    -> conservative SVGO profile
    -> optimized SVG, statistics, preview, download
```

V1 intentionally excludes automatic classification, similarity scoring, candidate search, LPIPS, LIVE, path mutations, crop editing, raster codec search, database storage, and authentication.

### 8.2 One-page UI

```text
Oh My SVG!
Turn pixels into tiny vectors.

[ Drop image here ]
[ PNG / JPG / WebP ]

[ Accurate ] [ Balanced ] [ Tiny ]

Original                 Vectorized
+----------------+       +----------------+
| raster preview |       |  SVG preview   |
+----------------+       +----------------+

[ statistics ]           [ Download SVG ]
```

Side-by-side preview is sufficient for V1. Preserve a component boundary for a later before/after slider. Show a checkerboard behind transparent images.

### 8.3 Presets

The UI exposes only three product presets. VTracer values live only in `presets.ts`; do not duplicate them in components or the Route Handler.

| Product preset | Goal | Initial VTracer direction |
|---|---|---|
| Accurate | preserve detail | high color/path precision, low speckle filtering, little/no simplification |
| Balanced | default trade-off | moderate palette/detail, moderate filtering, about 1 px simplification |
| Tiny | prefer smaller SVG | fewer colors, higher speckle filter, 2–2.5 px simplification, lower path precision |

Do not ship guessed magic numbers as permanent defaults. Start from pinned VTracer `photo`/`poster` presets, then calibrate overrides on the fixed corpus. Keep corner, length, and splice controls at upstream defaults in V1.

Advanced Settings is a later extension. When added, it edits a typed configuration derived from a preset and offers Reset instead of duplicating defaults.

### 8.4 Result information

Show:

```text
Original raster       412 KB
Raw SVG               284 KB
Optimized SVG          96 KB
SVG optimization         66%
Vectorization          142 ms
Optimization            31 ms
Paths                       143
Commands                    ...
Elements                    ...
Unique colors                18
```

`SVG optimization` is `(rawBytes - optimizedBytes) / rawBytes`. It is not the raster-to-SVG compression ratio. If SVG is larger than the raster, display that without treating conversion as an internal error.

### 8.5 Upload and runtime safety

- accept only static PNG, JPEG, and WebP; reject APNG and animated WebP rather than tracing one frame
- use `imageDimensionsFromData` to verify actual header format and dimensions; do not trust extension or browser MIME alone
- default upload limit: 10 MB
- initial limits: maximum width/height 8,192 px and maximum decoded area 40 megapixels
- reject a raw SVG larger than 25 MB before SVGO and response serialization
- never persist uploads or generated SVGs
- derive downloads from a sanitized base name: `cat.png` becomes `cat.svg`

The private-server assumption reduces exposure but does not justify trusting malformed bytes that could exhaust the machine.

### 8.6 Docker

Use Next.js standalone output for the self-hosted Docker image. The runtime image contains only the Node application and production packages.

```ts
// next.config.ts
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@visioncortex/vtracer'],
}

export default nextConfig
```

Copy `.next/standalone`, `.next/static`, and `public` into the runtime stage; run as a non-root user; bind `HOSTNAME=0.0.0.0`; and include `/api/health`. A production-image smoke test must prove that the pinned VTracer WASM artifact is copied and loadable.

Do not add custom Webpack configuration preemptively. If the production build cannot resolve or copy the WASM artifact, first try `serverExternalPackages: ['@visioncortex/vtracer']`, then retain it only when the Docker smoke test proves it is necessary.

The V1 production build did require this external-package boundary: without it, Turbopack rewrote VTracer's adjacent WASM lookup to a non-existent virtual `/ROOT/...` path. The Docker conversion smoke test confirms that the standalone image includes and loads the pinned WASM artifact.

### 8.7 V1 completion criteria

- PNG, JPG/JPEG, and WebP upload
- drag and drop plus keyboard-accessible file selection
- raster preview
- VTracer conversion through the pinned Node WASM package
- Accurate, Balanced, and Tiny presets in one configuration location
- conservative SVGO optimization
- safe SVG preview
- original, raw SVG, and optimized SVG byte counts
- vectorization and optimization timings
- reliable path, command, element, and unique-color counts
- `.svg` download with a derived name
- clear invalid-file/oversize messages and one generic conversion-failure message
- one concise server log for internal conversion failures
- no persistent or temporary files
- one small test for direct conversion success and thrown VTracer failure
- route smoke tests for all three formats and invalid input
- Docker standalone build and conversion smoke test
- English README with local/Docker run instructions, limits, and photo trade-offs

Implementation status (2026-08-23): every V1 criterion above is implemented. Unit and Route Handler tests, lint, TypeScript, the production build, and Docker conversion checks cover the non-browser pipeline. Formal browser upload, preview, and download verification remains deferred and is tracked in the implementation review; no completed real-browser pass is claimed here.

## 9. Raster R1/R2 follow-up

Crop and downloadable raster optimization form an independent track; their encoder settings are not implicitly applied to vectorization requests. Vector mode may reuse the orientation-corrected normalized crop semantics and safe ImageMagick process boundary, but its lossless cleanup stage has a separate contract in [Raster Cleanup and Vector Path Cleanup Design](./vector-cleanup-design.md).

Raster R1 uses an orientation-corrected normalized crop, optional no-upscale fit resize, and same-format PNG/JPEG/WebP encoding. It runs one ImageMagick 7 child process with `spawn(binary, args)`, `shell: false`, stdin/stdout buffers, explicit coder names, process/resource/output limits, and the existing generic client-error/request-ID log policy. The reviewed operation order is:

```text
decode -> EXIF auto-orient -> crop in normalized displayed coordinates
       -> optional fit resize -> metadata/color policy -> encode once
```

JPEG/WebP presets change lossy quality. PNG presets change lossless compression effort and must not be described as image quality. Manual R1 operations return the requested result even when it is larger and report a signed byte delta.

Raster R2 later searches a bounded encoder candidate set with SSIM as a calibrated primary gate. Its reference is the lossless result after auto-orient, crop, and resize—not the original uncropped image. This is distinct from the SVG V2 search below. Use the explicit names **Raster R2** and **SVG V2** in issues and UI.

## 10. SVG V2 — Auto Optimize

V2 generates a bounded set of VTracer/SVGO candidates, rasterizes each deterministically, and selects the smallest result meeting calibrated quality and complexity constraints.

```text
                    +-> Config A -> optimize -> rasterize -> measure
                    +-> Config B -> optimize -> rasterize -> measure
Raster -> VTracer --+-> Config C -> optimize -> rasterize -> measure
                    +-> Config D -> optimize -> rasterize -> measure
```

Start with 6–12 candidates and only two or three high-impact dimensions:

- `max_colors` or `color_precision`
- `filter_speckle`
- `simplify`
- SVGO `floatPrecision` as a small secondary dimension

Do not brute-force every option. Keep the three V1 presets as anchor candidates, evaluate coarse-to-fine, and stop exploring directions that already violate quality.

Each candidate records:

- optimized raw bytes; optional gzip bytes belong in offline benchmark reports rather than the production search loop
- path, command, element, and color counts
- SSIM, edge score, and color error
- vectorization, optimization, rasterization, and metric timings
- one failure/warning reason when relevant

Initial selection rule:

1. Reject invalid or non-renderable SVG.
2. Reject candidates below any calibrated fidelity threshold.
3. Reject candidates over complexity, memory, or runtime budgets.
4. Select the smallest serialized raw SVG.
5. If byte sizes are effectively tied, prefer fewer commands/elements.
6. Preserve Pareto alternatives only in the benchmark report.

An SSIM threshold such as `0.99` is an experiment, not a product truth. Calibrate thresholds by input category and manual review. Logos, UI screenshots, illustrations, and photographs do not tolerate the same error pattern.

Use one deterministic server-side SVG rasterizer for selection. The implemented baseline uses librsvg through ImageMagick. Browser preview alone is not reproducible enough for an optimization oracle; Chromium or resvg remains a second-renderer regression experiment rather than part of the hot loop.

### 10.1 Implemented SVG V2 baseline

The first SVG V2 implementation deliberately stays bounded:

- six fixed candidates: Accurate, Balanced, Balanced compact, Tiny, Compact, and Minimum;
- only `filterSpeckle`, `colorPrecision`, `simplify`, `maxColors`, path precision inherited from the anchors, and SVGO float precision vary;
- the original raster and each SVG are rendered to the same aspect-preserving evaluation size with a maximum 512 px edge and no upscaling;
- ImageMagick uses librsvg's `rsvg-convert` delegate and request-local SVG/MIFF files; the entire directory is removed after the request;
- candidates must pass `SSIM >= 0.75`, normalized pixel `MAE <= 0.12`, and grayscale Sobel edge `MAE <= 0.25` under the versioned `imagemagick-svg-v2` gate;
- candidates must stay at or below 100,000 paths, 1,000,000 commands, and 150,000 elements;
- a 90-second whole-search signal cancels ImageMagick work and prevents later candidates from starting;
- VTracer is currently synchronous WASM, so the implementation yields to observe request cancellation and checks the absolute deadline immediately after each synchronous stage, but cannot interrupt a vectorization call already executing;
- serialized optimized SVG bytes are the objective; command count and then element count break exact byte ties;
- pixel SSIM and MAE associate alpha before comparison, so invisible RGB does not affect selection while actual opacity loss remains measurable;
- the search retains only the current best passing candidate and does not compute unused gzip output in the production hot loop.

The thresholds are experimental bootstrap values. They are intentionally shown with their gate version in the UI and must be recalibrated on the fixed corpus. The 24 × 24 regression fixture evaluates all six candidates and verifies the selected result against every gate. Earlier exact scores belonged to the pre-associated-alpha v1 oracle and are intentionally not carried forward as v2 golden values. The renderer boundary was reproduced in the Node 24 Alpine production container with `rsvg-convert` 2.62.3.

Alpine required two deployment details that the macOS run did not reveal: install the separate `rsvg-convert` package, and pass the internally generated SVG through a named request-local file rather than ImageMagick's stdin-to-delegate temporary handoff. Docker tests cover this boundary.

## 11. SVG V3 — SVG simplification and research

V3 mutates the generated SVG itself:

- path merge
- point removal
- Bezier refitting
- near-color merge
- small-shape removal
- compatible layer merge
- local retracing of high-error regions

Every mutation is transactional:

```text
mutate -> rasterize -> measure
       -> keep when all gates pass
       -> otherwise roll back
```

Before V3, production post-vector cleanup remains VTracer's contour-aware `simplify` followed by conservative SVGO. In particular, do not expose a nominal `minPathArea` control implemented through regex, bounding boxes, or element length. It becomes valid only when a parsed mutation can be rasterized, measured against the approved cleaned-raster reference, and rolled back.

Only after this deterministic loop works should the project test differentiable rasterization, DiffVG, LIVE-style component initialization, contour-weighted loss, and self-intersection repair. These methods must beat the SVG V2 baseline under the same fidelity, complexity, byte, and runtime report.

## 12. Benchmark and tests

Create a small fixed corpus before calibrating presets:

- two-color logo and text logo
- transparent icon
- flat-color illustration
- JPEG-degraded illustration
- pixel art
- gradient clipart
- UI screenshot with small text
- natural, portrait, and landscape photographs
- large dimensions, incorrect metadata, and truncated files
- noise/texture designed to produce excessive paths

For each item, store expected policy, allowable metrics, and byte/path/runtime budgets in a manifest. Every preset or optimizer change produces a machine report and a human-reviewed contact sheet.

Required regressions include:

- transparent PNG edges do not gain black or white halos
- an EXIF-oriented JPEG remains a documented legacy V1 limitation until vector cleanup preprocessing is implemented
- no-dither color quantization reduces noisy color regions without manufacturing dither paths
- SVG Auto compares a cleaned conversion against the cleaned raster reference, not only the untouched source
- `viewBox` survives SVGO
- no `<image>`, script, event attribute, external URL, or `foreignObject` appears in true-vector output
- statistics handle relative path syntax and scientific notation
- failed VTracer/SVGO work returns only the generic client error and one useful server log
- oversized decoded images are rejected before expensive work
- Docker output converts the same pinned input successfully
- noisy photographs stop at configured resource budgets

## 13. Technical risks

| Risk | Impact | Response |
|---|---|---|
| VTracer 1.0 alpha API changes | broken builds or changed output | exact version pin, one wrapper, golden corpus |
| synchronous WASM blocks the Node event loop | temporarily unresponsive private server | strict input limits; add a Worker/CLI only after measurement |
| faithful photograph tracing | huge SVG and long runtime | warning, budgets, Tiny/poster/raster alternatives |
| SSIM-only acceptance | color or small-feature loss | edge and Delta E gates plus contact sheets |
| too much palette/path merging | deleted eyes, text, or details | high-contrast feature tests and rollback |
| low coordinate precision | contour movement and renderer differences | precision candidates and raster regression |
| alpha mishandling | dark/light edge halo | multiple compositing backgrounds |
| compressed-file expansion | memory exhaustion | header-based dimension and decoded-pixel limits |
| unsafe SVG preview | script or external-resource execution | internal producer, sanitization, `<img>` object URL |
| missing VTracer WASM in Docker | runtime-only failure | production-image conversion smoke test |
| missing or incompatible librsvg delegate | SVG Auto fails only in Docker | install `rsvg-convert`, use request-local SVG files, run Auto in the Docker builder |

## 14. Final recommendation

SVG V1/V2 and Raster R1/R2 now provide the deterministic baseline. The next work is corpus calibration: generate machine reports and human-reviewed contact sheets for logos, transparent icons, illustrations, screenshots, and photographs, then adjust candidate values and gates without changing the bounded architecture.

Add Potrace only if the binary corpus proves it earns its own process path. Keep ImageTracerJS, DiffVG, LIVE, and SVG V3 mutations as isolated experiments until they demonstrate a measurable improvement over the same benchmark.

The project succeeds when it can explain why a result is acceptable and choose a smaller, simpler SVG without crossing a visible-quality boundary—not merely when it saves every raster with an `.svg` extension.
