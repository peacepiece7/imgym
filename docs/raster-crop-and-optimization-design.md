# Raster Crop and Optimization Design

Status: Raster R1 and the bounded Raster R2 search are implemented; Raster R3 aggressive same-format optimization is planned  
Updated: 2026-08-27  
Scope: static PNG/JPEG/WebP crop, resize, same-format encoding, preview, reporting, quality-gated search, and the reviewed lossy-compression extension

## 1. Review outcome

The raster feature is a separate track named **Raster R1/R2**. The existing SVG vectorizer and its SVG V2/V3 roadmap remain independent.

```text
Browser crop selection
        |
        v
orientation-corrected normalized rectangle
        |
        v
POST /api/v1/optimize-raster (Node.js runtime)
        |
        v
validate encoded input and options
        |
        v
ImageMagick 7, one child process, stdin -> stdout
        |
        v
auto-orient -> crop -> optional fit resize -> encode once
        |
        v
result bytes + dimensions + timing -> preview and download
```

This R1 path is implemented. Raster R2 reuses the deterministic transform as an uncompressed reference, evaluates a bounded candidate set, and selects only candidates that pass its versioned visual gates.

The ImageMagick CLI remains the recommended engine. `child_process.spawn()` is appropriate here because the application controls its Docker image, the work is CPU/memory intensive, a failed or timed-out conversion can be terminated outside the Next.js process, and the same binary can be evaluated for Raster R2 similarity measurement. Use buffers over stdin/stdout; do not use shell command strings or normal-case temporary input/output files.

Sharp was reconsidered, not ignored. Its typed buffer API, `autoOrient` metadata dimensions, pixel limits, timeout, and codec options would make Raster R1 shorter. It is the best fallback if local ImageMagick installation becomes burdensome. It is not the default because the current plan explicitly values child-process isolation, the private Docker environment makes the system dependency manageable, and ImageMagick may also cover the later SSIM loop. Do not install both engines.

Before implementing Raster R1, move development, CI, TypeScript Node types, and both Docker stages from Node 20 to **Node 24 LTS**. Node 20 reached end of life on 2026-03-24. This runtime update is a prerequisite, not part of the raster feature itself.

## 2. Scope boundaries

Raster R1 includes:

- static PNG, JPEG, and WebP input
- one free-form crop rectangle, initially the full image
- an orientation-corrected normalized coordinate contract
- optional aspect-preserving fit resize with no upscaling
- same-format output only
- three explicit encoding presets per format
- original/result preview, bytes, dimensions, byte delta, and processing time
- output download
- generic client-facing conversion failures and detailed server logs
- input, decoded-pixel, process-time, and output-byte limits

Raster R1 deliberately excludes:

- animated PNG or WebP
- GIF, TIFF, HEIC, AVIF, PDF, SVG, or arbitrary ImageMagick delegates
- rotation controls, arbitrary transforms, filters, annotation, or a general image editor
- exact-size stretching, cover cropping, or upscaling
- automatic codec conversion
- live server processing while the crop handle is moving
- quality measurement or candidate search
- database, permanent uploads, authentication, or a job queue
- Python and Sharp

These exclusions avoid ambiguous semantics. An animated input must not silently become its first frame, a transparent image must not silently become JPEG, and a crop action must not quietly return the original merely because the encoded result is larger.

## 3. Engine decision

### 3.1 Comparison

| Criterion | ImageMagick 7 CLI | Sharp 0.35.x |
|---|---|---|
| Next.js integration | one `spawn()` wrapper | direct Node API |
| Input/output | stdin/stdout buffers | buffers directly |
| EXIF orientation | `-auto-orient` | `autoOrient()` |
| Crop/resize/codecs | complete | complete for this scope |
| Process isolation | yes | no; runs through the Node/libuv process |
| Cancellation | OS process timeout/kill | library processing timeout |
| Deployment | OS package plus JPEG/WebP modules | native Node package/prebuilt libvips |
| Later SSIM experiment | built-in `SSIM` metric | needs a metric implementation |
| Raster R1 code volume | moderately larger | smaller |
| Selected role | primary | documented fallback |

The selection is project-specific, not a general claim that ImageMagick is better than Sharp. Revisit it only if one of these measurable conditions occurs:

1. macOS and Docker installation cannot be made reproducible;
2. the process wrapper or temporary spill handling becomes materially larger than this design;
3. ImageMagick throughput is unacceptable on the fixed corpus; or
4. ImageMagick SSIM is rejected and process isolation no longer provides enough value.

If a switch is justified, replace the adapter behind the same `optimizeRaster()` contract. Do not maintain dual production paths.

### 3.2 Why `spawn()` rather than `exec()` or a shell

Use:

```ts
spawn(binary, args, {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
})
```

The wrapper uses an explicit timer so it can send `SIGTERM` and then escalate to `SIGKILL` after a fixed grace period.

Arguments are a string array, never an interpolated command. The uploaded filename is not passed to ImageMagick. The binary path comes from trusted configuration, defaulting to `magick`. Only server-validated numbers and server-owned preset values enter the argument list.

`spawn()` has no `maxBuffer` option. The wrapper must count stdout and stderr bytes while streaming, terminate the child when either cap is exceeded, and reject once. This belongs in the one wrapper rather than in every caller.

Do not add retries. A corrupt image, a resource limit, or an encoder failure will not become safer by immediately running the same work again.

## 4. Crop coordinate contract

### 4.1 Coordinate space

The authoritative crop is a half-open rectangle in the **displayed, EXIF-corrected image coordinate space**:

```ts
interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

All values are ratios, not percentages:

```text
0 <= x < 1
0 <= y < 1
0 < width <= 1
0 < height <= 1
x + width <= 1
y + height <= 1
```

`{ x: 0, y: 0, width: 1, height: 1 }` means the whole orientation-corrected image. The server rejects non-finite values and materially out-of-bounds rectangles. It may clamp only tiny floating-point overshoot at the right or bottom edge; it must not repair arbitrary invalid input.

Normalized coordinates are independent of CSS size, device-pixel ratio, and responsive layout. Do not send the preview element's pixel crop to the server.

### 4.2 UI library

Use and exactly pin `react-image-crop` `11.1.2` for the implementation spike. It directly returns a `percentCrop`, is responsive, supports pointer/touch and keyboard use, has no runtime dependencies, and does not bring rotation/filter/editor state that this phase does not need.

| Library reviewed | Strength | Cost for this scope | Decision |
|---|---|---|---|
| `react-image-crop` 11.1.2 | percent crops, touch, keyboard accessibility, no dependencies | EXIF preview must be verified | use |
| `react-easy-crop` 6.2.3 | polished zoom/rotation crop experience | extra transform state and dependency for features R1 excludes | do not add |
| CropperJS 2.1.1 | broad editing/custom-element system | wider API and package surface than one rectangle needs | do not add |

Client mapping:

```ts
const normalized = {
  x: percentCrop.x / 100,
  y: percentCrop.y / 100,
  width: percentCrop.width / 100,
  height: percentCrop.height / 100,
};
```

Keep the current normalized state from `onChange`. Do not call the server on drag events. A single **Crop and optimize** action sends the current rectangle.

The HTML standard defines `naturalWidth` and `naturalHeight` after metadata orientation, and current browsers display the natural appearance. Even so, EXIF orientations 2 through 8 must be tested with an asymmetric labeled fixture because the crop library documents historical browser inconsistencies. If any supported browser fails those tests, create an orientation-corrected browser preview with `createImageBitmap(file, { imageOrientation: "from-image" })`; do not add an EXIF parser first.

### 4.3 Normalized-to-pixel rounding

After `-auto-orient`, let the oriented image size be `W x H`. Convert the normalized half-open edges as follows:

```text
left   = clamp(floor(x * W), 0, W - 1)
top    = clamp(floor(y * H), 0, H - 1)
right  = clamp(ceil((x + width) * W), left + 1, W)
bottom = clamp(ceil((y + height) * H), top + 1, H)

cropWidth  = right - left
cropHeight = bottom - top
```

Flooring the leading edges and ceiling the trailing edges prevents a selected boundary pixel from disappearing because of fractional coordinates. The same formula must be used in tests and implementation.

Raster R1 can keep one ImageMagick decode by passing server-generated image expressions to `-crop` after `-auto-orient`, for example:

```text
%[fx:ceil(w*RIGHT)-floor(w*LEFT)]x%[fx:ceil(h*BOTTOM)-floor(h*TOP)]+%[fx:floor(w*LEFT)]+%[fx:floor(h*TOP)]
```

This is one argument in the `args` array. `LEFT`, `TOP`, `RIGHT`, and `BOTTOM` are fixed-decimal strings serialized only after numeric validation. No user-provided expression is accepted. A local ImageMagick 7.1.2 smoke test confirmed that these expressions are evaluated against the dimensions after `-auto-orient`.

## 5. Server processing contract

### 5.1 Order of operations

The command performs exactly one final encode:

```text
encoded input on stdin
    -> explicitly selected input coder and frame 0
    -> decode
    -> EXIF auto-orient
    -> reset virtual canvas
    -> crop in oriented coordinates
    -> reset virtual canvas
    -> optional fit resize, no upscale
    -> metadata/color policy
    -> same-format encode
    -> encoded output on stdout
```

The conceptual argument order is:

```text
magick
  <resource limits>
  <png:-[0] | jpeg:-[0] | webp:-[0]>
  -auto-orient
  +repage
  -crop <server-generated geometry>
  +repage
  [-resize <fit geometry with a literal no-upscale suffix>]
  <metadata policy>
  <format preset>
  <png:- | jpeg:- | webp:->
```

The literal `>` is part of the resize geometry argument and is safe because no shell is involved. Explicit coder prefixes prevent ImageMagick from selecting an unrelated decoder from a filename or arbitrary input declaration. `[0]` is defense in depth; animated files are rejected before the process starts.

### 5.2 Resize semantics

Use an optional fit box:

```ts
interface FitResize {
  maxWidth?: number;
  maxHeight?: number;
}
```

At least one dimension must be present when resize is enabled. Both values are positive integers within the output dimension limit. Preserve aspect ratio and never upscale:

```text
width only:   1600x>
height only:  x1600>
both:         1600x1200>
```

Do not expose resampling filters in R1. Use the pinned ImageMagick default and benchmark it. Add a filter option only if the corpus demonstrates a visible problem.

### 5.3 Metadata and color

Operation order is mandatory: auto-orient before removing EXIF. The output orientation is top-left and the old orientation tag must not survive.

Do not use an unqualified `-strip` until color-profile tests exist. ImageMagick documents that `-strip` also removes ICC, sRGB, and gamma information, which can change browser appearance. The initial policy is:

- remove EXIF, XMP, IPTC, comments, and other non-rendering metadata;
- preserve an embedded ICC profile when present;
- do not copy GPS or camera metadata;
- verify wide-gamut and CMYK JPEG fixtures in a browser;
- report only encoded dimensions and bytes, not metadata.

The first implementation candidate is `+profile`, `!icc,*`, which ImageMagick documents as the glob form for removing every profile except the named one, followed by `+set`, `comment`. PNG output additionally uses `-define`, `png:exclude-chunk=EXIF,iTXt,tEXt,zTXt,date` but does not exclude `iCCP`, `sRGB`, `gAMA`, or `cHRM`. These are individual `args` entries, not a shell fragment. Keep them in one metadata helper and prove their effect with metadata fixtures; do not scatter them across presets.

If selective profile removal cannot be made deterministic across the canonical Alpine build and supported local build, convert through an explicitly bundled sRGB profile and then strip. Do not silently discard a non-sRGB profile and call the pixels unchanged.

### 5.4 Static images only

Reject APNG and animated WebP before ImageMagick:

- PNG: reject a valid `acTL` animation-control chunk;
- WebP: reject the animation feature/chunks in the RIFF container;
- JPEG: inherently single-frame for this scope.

Keep these checks in the existing encoded-input validation area. They are format parsing, not ImageMagick policy. Malformed chunk lengths fail validation rather than being scanned as arbitrary text.

## 6. Presets

Use one preset table. UI labels describe quality for lossy formats and effort for PNG; do not pretend that PNG compression level changes visual quality.

```ts
type RasterPreset = "high" | "balanced" | "small";
```

Initial values are calibration seeds, not permanent truths:

| Format | High | Balanced (default) | Small |
|---|---|---|---|
| JPEG | quality 92, 4:4:4 | quality 82, 4:2:0 | quality 72, 4:2:0 |
| WebP | quality 90, method 4 | quality 82, method 5 | quality 72, method 6 |
| PNG | compression level 3 | compression level 7 | compression level 9 |

Rules:

- JPEG and WebP quality is an integer from 1 to 100.
- Keep JPEG chroma behavior explicit per preset with `-sampling-factor`. A quality number alone is not enough to promise text/color-edge fidelity; retain or adjust the initial values only after the corpus test.
- Keep WebP alpha quality at 100 in R1; do not silently damage transparency to save bytes.
- PNG R1 stays true-color and lossless. Do not enable palette quantization, `-colors`, dithering, or ImageMagick's overloaded PNG `-quality` option.
- Use `png:compression-level` explicitly. PNG's preset changes CPU effort and byte size, not pixels.
- Return the user's requested manual result even if it is larger. Show the signed byte delta. The “never choose a larger result” rule applies to automatic selection in Raster R2, not to an explicit crop/resize/encode request.
- Do not expose every ImageMagick define in an Advanced panel in R1.

A local smoke test on ImageMagick 7.1.2-18 found large, expected byte changes across JPEG/WebP quality settings and only small byte changes across PNG levels. That is evidence for the UI wording, not a substitute for the project corpus.

## 7. HTTP and internal APIs

### 7.1 Route

Add `POST /api/v1/optimize-raster` as a Route Handler with:

```ts
export const runtime = "nodejs";
```

Request: `multipart/form-data`

- `image`: one file
- `options`: one JSON object containing `crop`, optional `resize`, and `mode`

Do not spread individual ImageMagick flags across form fields. Parse the one JSON settings object, reject unknown enum values, and validate every number server-side.

On success, return the encoded image as the response body, not base64 JSON. Use:

- correct `Content-Type` (`image/png`, `image/jpeg`, or `image/webp`)
- `Content-Disposition` with a server-sanitized same-format filename
- `Cache-Control: no-store`
- small ASCII metadata headers for original/output bytes, output dimensions, processing time, selected preset, candidate count, and optional SSIM/MAE

The client already owns the original file bytes and can obtain oriented preview dimensions from the loaded image. It reads the success body as a `Blob` and creates an object URL. Avoid base64's byte and memory overhead and avoid a custom multipart response parser.

On expected validation failure, return the existing short 400/413 messages. On processing failure, return only:

```json
{ "error": "Image processing failed.", "requestId": "..." }
```

The server log contains the request ID, elapsed time, input format and byte count, preset name, child outcome (`spawn`, timeout, signal, exit code, stdout cap, or stderr cap), and bounded stderr. Do not send raw ImageMagick stderr to the browser.

### 7.2 Internal contract

Keep HTTP handling and process execution separate:

```ts
interface OptimizeRasterOptions {
  crop: NormalizedCrop;
  resize?: FitResize;
  mode: RasterPreset | "auto";
}

interface OptimizeRasterResult {
  image: Buffer;
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  durationMs: number;
  selection: RasterSelection;
}

async function optimizeRaster(
  image: Buffer,
  options: OptimizeRasterOptions,
): Promise<OptimizeRasterResult>;
```

The route should read approximately as:

```ts
const validation = validateRaster(image);
const result = await optimizeRaster(image, options);
return new Response(result.image, { headers });
```

Do not create a generic graph executor, encoder interface hierarchy, event bus, plugin registry, or pipeline DSL. There is one engine and one operation sequence.

### 7.3 Suggested file boundaries

```text
src/
|-- app/api/v1/optimize-raster/route.ts
|-- components/raster-workspace.tsx
|-- components/raster-settings.tsx
|-- components/raster-result.tsx
`-- lib/raster/
    |-- crop.ts
    |-- filename.ts
    |-- image-magick.ts
    |-- optimize-raster.ts
    |-- presets.ts
    |-- validate-raster.ts
    `-- types.ts
```

Only split a component further when it has an independent responsibility in the implemented UI.

## 8. Process and resource safety

Retain the current 10 MiB upload limit and existing signature/dimension validation. Add static-animation rejection. Revalidate all fields at the route boundary.

Initial limits to calibrate in Docker:

| Limit | Initial value |
|---|---:|
| encoded upload | 10 MiB |
| width or height | 8192 px |
| decoded area | 25 megapixels |
| output stdout | 32 MiB |
| stderr retained in log | 64 KiB |
| ImageMagick threads per request | 2 |
| ImageMagick memory cache | 256 MiB |
| ImageMagick mapped cache | 512 MiB |
| ImageMagick disk cache | 1 GiB |
| ImageMagick open files | 64 |
| ImageMagick processing time | 30 s |
| Node child timeout | 35 s |

Pass ImageMagick width, height, area, memory, map, disk, file, thread, and time limits either as trusted command arguments or `MAGICK_*_LIMIT` environment values. The Node timeout is deliberately longer than ImageMagick's internal time limit so ImageMagick can fail cleanly first. These are starting limits for a Q16-HDRI build, not guarantees that every 25 MP image will fit; measure peak memory and spill usage on the boundary corpus before raising either pixels or concurrency.

ImageMagick may spill pixel caches even when input/output use pipes. Set `MAGICK_TEMPORARY_PATH` to a request-specific directory created with `mkdtemp`, and remove that exact directory in `finally`. Never use a shared predictable request filename. The cleanup path must be explicit and validated; no broad recursive target or unresolved environment variable is allowed.

Do not spread `process.env` into the ImageMagick child. Pass only the executable path, locale, required dynamic-library/font/ImageMagick configuration paths, and request-local cache paths. In particular, `OHMYIMG_API_KEY` and unrelated server secrets must not reach ImageMagick or its delegates.

The wrapper settles only once and handles:

- synchronous spawn error
- stdin error or early child exit
- timeout/abort
- signal or non-zero exit
- stdout/stderr cap
- successful zero exit with empty output
- output signature/dimension mismatch

On timeout, send `SIGTERM`; if the child has not closed after a short fixed grace period, send `SIGKILL`. Clear the escalation timer after `close` and keep the one-settlement guard.

This is not an instruction to build an exception hierarchy. One internal `Error` plus a structured server log is sufficient. The route converts it to the generic response.

Do not create a custom ImageMagick `policy.xml` in R1 unless a verified default policy blocks the required operation or an actual threat model requires it. A copied “secure” example can accidentally disable stdin/stdout. Explicit coder prefixes, disabled shell use, static formats, process limits, output caps, and a private deployment are the smaller auditable boundary.

## 9. UI behavior

Keep the feature on one page or in a simple top-level mode switch between **Vectorize** and **Optimize raster**. Do not mix vector presets with raster presets.

Raster flow:

1. Drop/select a supported static image.
2. Show the browser-oriented original with a full-image crop selected. Scale the complete image into the crop viewport; do not place the crop coordinate surface inside a centered scroll container.
3. Adjust the crop with pointer, touch, or keyboard.
4. Optionally set max width/height.
5. Choose High, Balanced, or Small.
6. Press **Crop and optimize**.
7. Show original and result side-by-side.
8. Show bytes, oriented dimensions, signed byte and percentage delta, and processing time.
9. Download with the original basename and same extension.

Do not upload on every crop change. Keep the latest percent crop synchronously available for the submit handler, validate it immediately before submission, and show its natural-pixel dimensions so a full-image selection cannot be mistaken for a crop. Disable the request-affecting controls while a request is active so the displayed settings cannot diverge from the in-flight result. Invalidate a stale result whenever crop, resize, or encoding settings change. Preserve the chosen crop and settings after an error. Revoke old input and output object URLs when a file/result is replaced or the component unmounts.

Byte reporting must be unambiguous:

```text
Original       412 KB   3024 x 4032
Result         118 KB   1200 x 900
Change        -294 KB   -71.4%
Processing      186 ms
```

Use “larger by” or a positive signed delta when output grew. Do not label this value “quality” or “optimization” when it is only a byte difference.

## 10. Docker and runtime preflight

The implemented runtime baseline is:

1. Node 24 in both Docker stages and `engines.node`;
2. matching Node 24 TypeScript definitions;
3. existing SVG regression tests retained;
4. ImageMagick present in the Docker builder for regression tests and in the runtime image for requests.

For the canonical Alpine 3.24 runtime image, install ImageMagick plus the split JPEG and WebP coder modules explicitly:

```text
imagemagick
imagemagick-jpeg
imagemagick-webp
```

PNG support is in the base ImageMagick package. The 2026-08-23 canonical Docker smoke test resolved ImageMagick 7.1.2-27 on Node 24.19.0 and proved JPEG, PNG, and WebP read/write support. Record resolved versions with test output rather than asserting that Homebrew and Alpine emit identical bytes. Exact Alpine package pins are intentionally not embedded because stable-repository security upgrades replace old revisions; reproducible releases should pin the final base image digest after calibration.

Do not add Next.js bundler configuration for ImageMagick; it is an external executable, not a JavaScript import. Keep the Route Handler on the Node runtime. The existing standalone output remains appropriate for the private Docker server.

## 11. Verification plan

### 11.1 Unit tests

- normalized rectangle validation, including NaN, Infinity, zero area, and edge overshoot
- half-open rounding for full image, single-pixel edge, fractional center, and right/bottom bounds
- resize geometry for width-only, height-only, both, no resize, and no upscale
- exact preset-to-argument mapping for every format
- safe filename conversion and MIME mapping
- APNG and animated WebP rejection
- process wrapper single settlement and bounded stderr
- generic error mapping without stderr leakage

### 11.2 Image fixtures

- EXIF orientations 1 through 8 with labeled asymmetric quadrants
- portrait and landscape JPEG
- transparent and opaque PNG
- transparent and opaque WebP
- ICC-profiled sRGB, Display P3, and CMYK JPEG samples
- one-pixel-wide crop near each image edge
- very small image, 8192 px edge, 25 MP boundary, and one-over-limit cases
- malformed/truncated payloads with valid-looking signatures
- APNG and animated WebP
- high-entropy PNG that can exceed the stdout cap

### 11.3 Integration assertions

- displayed crop and output pixels match for all EXIF orientations
- output has top-left orientation and no camera/GPS metadata
- ICC behavior preserves browser appearance within the chosen tolerance
- resize preserves aspect ratio and never upscales
- PNG presets decode to identical RGBA pixels after the same color policy
- JPEG/WebP preset sizes generally order as expected on the corpus; exceptions are reported, not hidden
- no normal request creates persistent files
- time, memory, and output limits fail with the generic client error and a useful request-ID log
- Docker declares read/write support for PNG, JPEG, and WebP
- existing raster-to-SVG behavior is unchanged

Browser verification must include crop selection, processing, result preview, signed size reporting, download, invalid input, and at least one EXIF orientation other than 1.

## 12. Raster R2 — SSIM-guided Auto Optimize

Raster R2 is separate from **SVG V2 — Auto Optimize**. Use the names in UI, issues, and documents to avoid treating two different search spaces as one feature.

### 12.1 Correct reference image

Similarity must not compare a cropped/resized result with the uncropped original. Build the reference from the deterministic non-lossy part of the requested operation:

```text
input
  -> auto-orient
  -> crop
  -> resize
  -> common color/alpha normalization
  -> uncompressed reference pixels
```

Each candidate changes only encoder parameters, is decoded back to the same pixel dimensions/color representation, and is compared with that reference.

### 12.2 Initial bounded search

Do not search every ImageMagick option. Begin with 6–8 fixed candidates for JPEG or WebP, generated from the same reference. Record:

- exact encoder arguments and ImageMagick version
- encoded bytes
- SSIM
- a cheap color/pixel error guard
- encode, decode, and metric time

For lossless true-color PNG, SSIM is unnecessary because decoded pixels should be identical. Encode the fixed compression levels, bound each file before reading it, sort by bytes with candidate order as the deterministic tie-breaker, and MAE-check candidates smallest-first until a decoded lossless candidate passes. Only that winner enters Node memory. Palette PNG is a later lossy search and must pass the same visual gates as JPEG/WebP.

Initial selection rule:

1. Include the explicit High preset as the non-search baseline.
2. Reject invalid, wrong-dimension, or wrong-format output.
3. Reject a candidate below the calibrated SSIM threshold or above a secondary error bound.
4. Select the smallest encoded byte count among passing candidates.
5. Never automatically choose a result larger than the passing baseline.
6. If no candidate, including the baseline, passes, record that Auto Optimize found no acceptable result and return the standard generic processing error plus request ID; do not label a failing candidate acceptable.

The current `imagemagick-v2` experimental gate is `SSIM >= 0.99` and normalized `MAE <= 0.02`. ImageMagick reports SSIM as distortion, so the implementation converts it to similarity with `1 - distortion`. Version 2 associates alpha before both pixel comparisons: RGB under zero alpha is ignored, while a real alpha-channel change remains part of the error. The thresholds are unchanged, versioned starting points rather than a universal definition of acceptable quality.

Raster Auto retains only the smallest passing candidate buffer seen so far. PNG candidates are bounded on disk and ranked before the single lossless check. JPEG and WebP candidates run sequentially as encode, measure, select, and immediate unlink. The request directory cleanup remains the final backstop. This keeps the selection rule unchanged without retaining as many as seven output buffers or lossy candidate files simultaneously.

The Auto search has a 90-second whole-search deadline in addition to ImageMagick's 35-second per-child timeout. The API request signal is propagated to every active ImageMagick encode and comparison, so a disconnected client terminates active child work and no later candidate is started. On the POSIX production target, each ImageMagick child leads a process group; `SIGTERM` followed by bounded `SIGKILL` escalation also terminates delegates such as `rsvg-convert`. Errors remain intentionally generic to the client and retain bounded diagnostics in server logs under the request ID.

### 12.3 Metric implementation decision gate

Evaluate ImageMagick's built-in SSIM first because it reuses the selected binary and exposes the metric without a new runtime. Use `-format "%[distortion]" info:` rather than parsing human-oriented stderr where possible. Pin and record ImageMagick because SSIM values are not assumed comparable across implementations or versions.

Before adopting it as the optimizer oracle, compare its ranking against:

- the original/reference SSIM implementation or a validated JS implementation;
- manual contact sheets across photographs, UI text, flat art, gradients, and transparency;
- black and white compositing for alpha-bearing images.

If ImageMagick SSIM is unstable or its process/file choreography dominates the implementation, use decoded RGBA buffers plus one maintained, validated JS SSIM package. Do not introduce Python solely for SSIM. `ssim.js` is dependency-free but its latest published release is old; a current alternative must still be validated against fixed golden scores before adoption.

SSIM remains a primary gate, not the only measurement. It can miss color shifts, sparse text damage, and small high-contrast details. Raster R2 should pair it with one inexpensive color/pixel guard and manual calibration before adding more metrics.

## 13. Raster R3 — Aggressive same-format optimization plan

### 13.1 Existing optimization audit

Raster optimization is already implemented; R3 extends it rather than adding a second pipeline.

| Format | Current manual presets | Current Auto search | Missing opportunity |
|---|---|---|---|
| JPEG | lossy quality `92/82/72`, explicit `4:4:4` or `4:2:0` chroma sampling | seven quality candidates from 92 to 72, selected by bytes under SSIM/MAE gates | optimized entropy coding, progressive candidate, and a calibrated lower-quality range |
| WebP | lossy quality `90/82/72`, method `4/5/6`, lossless alpha | seven quality candidates from 90 to 70 | sharper RGB-to-YUV and auto-filter candidates; lower-quality candidates after calibration |
| PNG | true-color lossless compression level `3/7/9` | four lossless compression levels, requiring decoded MAE `0` | lossless filter/strategy search and opt-in lossy palette quantization |

Metadata removal, crop, resize, and same-format re-encoding also reduce bytes today. For most photographs, pixel dimensions and JPEG/WebP quality dominate the result. For true-color PNG logos, screenshots, and illustrations, DEFLATE effort alone usually provides only a small improvement; reducing the stored palette is the material next step.

R3 keeps the existing objective:

```text
minimize encoded output bytes

subject to:
  same output format
  correct dimensions and decodability
  every versioned visual-quality gate passes
```

It does not optimize a reported percentage, quality number, or path count. A candidate is useful only when its actual serialized output is smaller than the safe fallback.

### 13.2 User contract

Add one optional policy, not a panel of codec flags:

```ts
type RasterOptimizationPolicy = "standard" | "smaller";

interface OptimizeRasterOptions {
  crop: NormalizedCrop;
  resize?: RasterResize;
  mode: RasterMode;
  optimization?: {
    policy: RasterOptimizationPolicy;
  };
}
```

An omitted `optimization` object means `standard` and preserves the current API behavior. The policy changes candidate ownership only; no client-provided value becomes an ImageMagick argument directly. A successful response should retain `X-Selected-Preset` and `X-Candidate-Count`, add the requested `X-Optimization-Policy`, and return the versioned quality gate and measured values whenever a lossy Auto candidate is selected. Raw encoder arguments remain server-log/calibration data, not public response headers.

- **Standard**: the current behavior. PNG stays pixel-identical; JPEG/WebP use the current bounded lossy range.
- **Smaller**: Auto may evaluate palette PNG and more aggressive JPEG/WebP candidates. Every result remains quality-gated and falls back to the smallest passing Standard candidate.

Initially expose the Korean UI choice **더 작게 (추가 화질 손실 허용)** only when Auto is selected, paired with **표준**. Format-aware Korean help text is mandatory because “lossy” means different things here: PNG may reduce colors, while JPEG and WebP already use lossy encoding in Standard mode. Manual High/Balanced/Small presets remain deterministic and unchanged.

Do not add separate public controls for palette size, dithering, chroma sampling, progressive scans, WebP filters, or alpha quality. The private application benefits more from a small auditable candidate table than from recreating an encoder GUI.

### 13.3 PNG plan

Implement PNG in two bounded tiers.

**Tier A — improved lossless search**

- Keep the existing compression-level candidates.
- Benchmark a small set of explicit `png:compression-strategy` and filter combinations; do not search the full Cartesian product.
- Require associated-alpha MAE `0` after decoding.
- Keep the smallest result and use the existing true-color PNG as the fallback.

ImageMagick overloads PNG `-quality` with compression and filter semantics, so R3 continues to use explicit `png:*` defines. `-type optimize` may be benchmarked as a candidate but must not become an undocumented global switch.

**Tier B — lossy palette search for Smaller policy**

Generate a small initial grid, such as `256`, `128`, `64`, and `32` maximum colors. Quantize in one pinned color space, preserve alpha during palette selection, and test no-dither plus at most two adaptive-dither candidates. Unlike raster-to-vector preprocessing, downloadable raster output may benefit from adaptive dithering; it must be judged by both encoded bytes and visible banding. Do not assume that no-dither is always smaller or more acceptable.

Do not implement Tier B as an unconditional `png:format=png8`. ImageMagick documents that forced PNG8 has at most 256 colors and only one fully transparent palette entry, so it may damage partial-alpha antialiasing, shadows, or glows. Reject any candidate that changes alpha beyond the calibrated bound. Inspect transparent fixtures on light, dark, and checkerboard backgrounds.

The first implementation should use ImageMagick so it reuses the existing process wrapper and Docker dependency. Benchmark `pngquant` offline against that baseline because it provides premultiplied-alpha-aware palette generation, adaptive dithering, a quality range, and skip-if-larger behavior. Adopt it only if the corpus shows a meaningful byte or visual-quality advantage; a second production binary is not justified by feature count alone.

### 13.4 JPEG plan

Keep quality and chroma sampling as a paired candidate definition. The initial Smaller grid should extend below the current floor only modestly—for example qualities `70`, `66`, and `62`—and retain selected `4:4:4` candidates for screenshots or saturated edges rather than assuming `4:2:0` always wins perceptually.

Add these as independently ranked candidates:

- `jpeg:optimize-coding=true` for optimized entropy coding;
- progressive output through `-interlace Plane`;
- baseline versus progressive at a small number of quality/sampling anchors.

Rank actual bytes because progressive JPEG can be slightly smaller or larger depending on content. Do not initially expose or search arithmetic coding, DCT methods, custom quantization tables, or `jpeg:extent`. `jpeg:extent` targets an arbitrary byte budget, while OhMyImg already solves the clearer inverse problem: smallest candidate that passes external quality gates.

MozJPEG is a later benchmark, not an R3 dependency. Its trellis quantization and progressive scan optimization may improve size/quality, but changing the JPEG implementation or adding another CLI must earn its operational cost on the same corpus.

### 13.5 WebP plan

Keep method `6` as the slowest bounded production effort. For Smaller policy:

- extend the quality grid carefully, initially to about `68`, `64`, and `60`;
- test `webp:use-sharp-yuv=true` at selected quality anchors to protect saturated edges;
- test `webp:auto-filter=true` as a separate candidate rather than enabling it globally;
- keep `webp:alpha-quality=100` in the first R3 release.

Lossy alpha can create visible halos and should become a separate later experiment only after alpha MAE and multi-background composite gates exist. Similarly, do not add target-size, target-PSNR, content hints, or direct `cwebp` execution initially. The existing external candidate search already ranks real byte size under project-owned gates; encoder-internal target searches add passes and make the selected trade-off harder to explain.

Direct `cwebp` becomes relevant only if ImageMagick fails to expose a required, reproducible libwebp option. It should replace the WebP encoder adapter in that case, not form a second normal path.

### 13.6 Quality gates and fallback

Reuse the post-orient/crop/resize lossless reference from Raster R2. R3 must not compare against the uncropped upload or against a previously lossy candidate.

SSIM and whole-image MAE are insufficient for palette screenshots, text, and transparency on their own. Before enabling Smaller in the UI, version a new raster gate containing:

- associated-alpha SSIM;
- associated-alpha MAE;
- an edge-weighted error guard for text, one-pixel rules, and hard contours;
- a direct alpha error bound for formats with alpha;
- manual light/dark/checkerboard review during offline calibration.

The exact thresholds remain corpus results, not design constants. Candidate failures stay in request-scoped server logs. A failed aggressive candidate is normal search data, not a user-visible processing error.

Selection order is:

1. Produce and validate the deterministic transformed reference.
2. Produce Standard fallback candidates.
3. If policy is Smaller, produce the bounded additional candidates sequentially.
4. Reject wrong-format, wrong-size, oversized, or quality-failing outputs.
5. Return the smallest passing candidate; on any Smaller-specific failure, return the Standard winner.
6. Return the generic processing error only when no Standard candidate succeeds.

Keep the existing 90-second whole-search deadline. Start with no more than 8–12 total candidates per format and remove dominated candidates after corpus measurement. Do not increase the deadline merely to preserve every experimental combination.

### 13.7 Delivery sequence

1. Extend the calibration report to record every internal raster candidate, exact encoder arguments, bytes, time, and gate results.
2. Add and calibrate edge and alpha guards without changing production selection.
3. Add PNG Tier A lossless candidates and remove any consistently dominated combination.
4. Add the backward-compatible `standard | smaller` option and PNG palette candidates behind it.
5. Add JPEG optimized/progressive and lower-quality candidates.
6. Add WebP sharp-YUV/auto-filter and lower-quality candidates.
7. Run the private corpus and browser contact-sheet review before exposing Smaller by default.
8. Benchmark pngquant, MozJPEG, or direct cwebp only after the ImageMagick implementation provides a measured baseline.

Cross-format conversion to WebP or AVIF is intentionally a later feature. It can save substantially more for some sources, but it changes response MIME type, filename, download expectations, transparency behavior, Docker delegates, and API semantics. Do not mix it into same-format Raster R3.

## 14. Implementation and verification record

The feature was implemented in this order:

1. Node 24 migration and unchanged V1 verification.
2. Static-image and animation validation fixtures.
3. Normalized crop types, validation, and rounding tests.
4. One ImageMagick spawn wrapper with limits and logs.
5. Preset mapping and `optimizeRaster()`.
6. Binary Route Handler response.
7. Crop UI, preview, result report, and download.
8. Docker codec modules and end-to-end verification.
9. Fixed corpus calibration and preset adjustments.
10. Raster R2 metric spike after the manual pipeline was stable.

Raster R1 is complete when:

- PNG, JPEG, and WebP crop correctly for EXIF orientations 1–8;
- resize is aspect-preserving and no-upscale;
- all nine format/preset combinations work;
- original/result previews, bytes, dimensions, delta, timing, and download work;
- animation, invalid input, resource limit, timeout, and output-cap failures are handled;
- only a generic error plus request ID reaches the client;
- Docker proves all three coders and the end-to-end route;
- the existing SVG vectorizer suite still passes;
- README setup instructions include ImageMagick for local development; and
- Raster R2 remains a separate bounded branch rather than complicating the one-process manual path.

Verification recorded on 2026-08-23:

- 72 Vitest assertions pass across validation, percent-to-normalized UI crop conversion, decoded crop-pixel equivalence without resize, crop math, every EXIF orientation, all nine manual format/preset combinations, stdout/stderr/file process caps, metadata and ICC handling, CMYK output, alpha preservation, Raster Auto selection/rejection, SVG Auto selection and metrics, both Route Handlers, and the existing manual SVG pipeline;
- TypeScript, ESLint, and the Next.js production build pass;
- a fresh Docker build runs the same 72 tests and passes the Next.js build on Node 24.19.0 and ImageMagick 7.1.2-27;
- the container proves JPEG/PNG/WebP read/write delegates, librsvg rasterization, non-root standalone startup, `/api/health`, manual crop/resize output, Raster R2 Auto response headers, SVG V1 conversion, and the full six-candidate SVG V2 search;
- the tested Auto JPEG selected the High baseline at SSIM 0.997620 and normalized MAE 0.002226; this is a pipeline proof, not corpus calibration;
- the automated in-app browser check could not run because this execution environment exposed no browser instance. Crop interaction, preview rendering, and download still require a real-browser pass before treating browser coverage as complete.

The following calibration work is intentionally not claimed as complete: a representative photo/art/text corpus, black/white alpha compositing contact sheets, Display P3 and browser-rendered CMYK appearance comparisons, peak-resource boundary measurements, and cross-browser EXIF crop interaction. These are evidence-gathering tasks; they do not require expanding the production architecture.

## 15. Verification addendum — 2026-08-24

The 72-assertion result above is the preserved 2026-08-23 raster/SVG implementation record. After the API, calibration-runner, bounded multipart, child-environment isolation, document-to-PDF, associated-alpha metric, animated-vector-input, child-cancellation, process-tree cleanup, and vector-cleanup additions, the current shared repository suite contains 120 passing tests. This larger total is not a claim that the historical raster run contained 120 tests, and it does not close the deferred raster browser or corpus-calibration work recorded above.

## 16. Primary references

- [ImageMagick command-line options](https://imagemagick.org/command-line-options/)
- [ImageMagick WebP encoding options](https://imagemagick.org/webp/)
- [ImageMagick format-specific defines](https://imagemagick.org/defines/)
- [ImageMagick quantization examples](https://usage.imagemagick.org/quantize/)
- [ImageMagick compare tool](https://imagemagick.org/compare/)
- [pngquant official repository](https://github.com/kornelski/pngquant)
- [MozJPEG official repository](https://github.com/mozilla/mozjpeg)
- [Google `cwebp` encoder reference](https://developers.google.com/speed/webp/docs/cwebp)
- [Wang et al., Image Quality Assessment: From Error Visibility to Structural Similarity](https://www.cns.nyu.edu/pub/lcv/wang03-reprint.pdf)
- [Node.js `child_process.spawn()`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [React Image Crop README](https://github.com/dominictobias/react-image-crop/blob/master/README.md)
- [React Easy Crop](https://github.com/ValentinH/react-easy-crop)
- [CropperJS](https://github.com/fengyuanchen/cropperjs)
- [HTML image natural dimensions and orientation](https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-naturalwidth-dev)
- [`createImageBitmap()` orientation behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [Sharp constructor and safety options](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp metadata](https://sharp.pixelplumbing.com/api-input/)
- [Sharp crop and resize](https://sharp.pixelplumbing.com/api-resize/)
- [Sharp output formats and timeout](https://sharp.pixelplumbing.com/api-output/)
- [Alpine ImageMagick WebP module](https://pkgs.alpinelinux.org/package/v3.23/community/x86_64/imagemagick-webp)
- [Alpine ImageMagick JPEG module](https://pkgs.alpinelinux.org/package/v3.23/community/x86_64/imagemagick-jpeg)
