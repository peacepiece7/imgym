# Raster Cleanup and Vector Path Cleanup Design

Status: Phase A implemented; corpus calibration and Phases B-D remain  
Updated: 2026-08-27  
Scope: vector-specific raster cleanup before VTracer and conservative cleanup after tracing

## 1. Problem and decision

Shadows, antialiasing, glow, blur, semi-transparent edge pixels, and JPEG/PNG noise are frequently interpreted as distinct color regions. The result can contain hundreds or thousands of tiny paths even when the visible subject is simple.

The next vectorization increment adds an explicit preprocessing stage:

```text
validated raster
    -> EXIF auto-orient
    -> optional normalized crop
    -> vector cleanup with ImageMagick
    -> lossless in-memory raster
    -> VTracer
    -> conservative SVGO
    -> statistics, preview, download
```

This is a deliberate visual edit, not ordinary lossless optimization. The UI must show its effect and must not imply that a flat three-color result is simply a compressed copy of a photograph.

Use ImageMagick 7 through the existing `child_process.spawn(binary, args)` boundary with `shell: false`. Pass the source on stdin and receive a lossless PNG or MIFF buffer on stdout. Do not create a second Python preprocessing path, re-encode an intermediate as JPEG/WebP, or add a general image-processing framework.

## 2. Evidence and constraints

VTracer exposes `filterSpeckle` (discard small pixel patches), `colorPrecision` (significant RGB bits), `layerDifference`/gradient step (separation between flat gradient layers), `maxColors`, and `simplify` (curve-fitting tolerance). The pinned package's names and ranges remain centralized in the adapter. See the official [VTracer options](https://github.com/visioncortex/vtracer/blob/master/README.md) and [web control definitions](https://github.com/visioncortex/vtracer/blob/master/docs/index.html).

ImageMagick's adaptive `-colors N` quantizer is preferable to `-posterize` for the Colors control. `-posterize` divides channels into uniform levels; it does not choose a palette that best represents this image. Dithering must be disabled with `+dither`, because dithering creates the exact alternating pixel patterns that become tiny vector regions. Quantization color space materially changes the selected palette, so the first implementation fixes and tests one color space rather than exposing it. See ImageMagick's [quantization examples](https://usage.imagemagick.org/quantize/) and [command option reference](https://imagemagick.org/command-line-options/).

When input is already quantized, VTracer's maintainer recommends `colorPrecision: 8` so clustering preserves those palette colors instead of averaging them again. Therefore ImageMagick, not VTracer, is authoritative for an explicitly selected Colors limit. `maxColors` may be retained only as the same-value safety cap after calibration proves it does not alter the palette. This avoids two independent quantizers fighting each other. See the upstream [preprocessing discussion](https://github.com/visioncortex/vtracer/discussions/83).

VTracer currently represents smooth ramps as multiple solid-color layers. Raising gradient step reduces the number of layers, but does not create a true SVG gradient. Upstream true-gradient fitting remains a proposal, so the product must label this control as flattening rather than lossless gradient optimization. See the upstream [gradient-paint proposal](https://github.com/visioncortex/vtracer/discussions/127).

## 3. Product controls

### 3.1 Basic controls

The default panel exposes only two controls:

```text
Cleanup     Clean  --------o----  Detail
Colors          4  -------o-----  Full
```

- **Cleanup** jointly controls mild edge-preserving raster denoise, VTracer speckle filtering, and curve simplification. It does not silently change palette size, alpha, or gradient behavior; those have separate controls.
- **Colors** controls the maximum pre-vector palette. Use ordered stops instead of a mathematically linear range: `3`, `4`, `6`, `8`, `16`, `32`, `64`, `128`, `Full`. `Full` means no ImageMagick color quantization, not a promise to reproduce every source RGB value in SVG.

The provisional default is a middle Cleanup level and `64` colors until corpus calibration proves a better value. Optional shortcuts reuse the same Colors setting:

| Shortcut | Colors stop | Intended input |
|---|---:|---|
| Full | Full | already clean art or maximum fidelity |
| Clean | 16 | illustration with noise or soft edges |
| Logo | 6 | simple brand marks |
| Flat | 3 | intentionally posterized art |

Selecting a shortcut only moves the Colors control. It is not another preset layered over Accurate/Balanced/Tiny.

### 3.2 Advanced controls

Advanced Settings reveals the resolved values that the basic controls already drive:

| Control | Initial contract | Owner | Notes |
|---|---|---|---|
| Speckle size | integer `0..128` px | VTracer `filterSpeckle` | region pixel count, not diameter or SVG area |
| Alpha cutoff | Off or integer `0..255` | ImageMagick alpha channel | pixels at/below cutoff become transparent; pixels above retain their alpha initially |
| Gradient step | integer `0..128` initially | VTracer `layerDifference` | higher means flatter/fewer layers; the UI starts with the official web range |
| Color precision | integer `1..8` | VTracer `colorPrecision` | fixed/read-only at `8` when palette limiting is active |
| Path simplify | number `0..4` px | VTracer `simplify` | curve-fit tolerance, not an arbitrary percent |
| Min path area | experimental, unavailable initially | post-vector stage | requires parsed geometry and quality-gated rollback |

Editing an advanced value changes the setting label to **Custom**. Reset restores the selected Accurate/Balanced/Tiny anchor and its derived cleanup values. Basic and advanced controls are two views of one canonical configuration; they must never be stored as duplicate state.

### 3.3 Deferred controls

The expanded design may later contain:

```text
Transparency   Keep  -----o-----  Remove
Gradient       Flat  -----o-----  Detailed
[ Remove background ]
```

Transparency and Gradient can ship after the two-control baseline is calibrated. Their directions must be explicit: `Keep -> Remove` raises the alpha cutoff, while `Flat -> Detailed` lowers `layerDifference`.

Do not ship one-click **Remove background** yet. Alpha cleanup only processes existing transparency; it cannot identify a background. A deterministic version needs an explicitly sampled color, tolerance, and edge-connected flood-fill rule so it does not delete an identically colored subject. Automatic semantic background removal is a different ML feature. Both require before/after preview and a dedicated corpus.

Do not add a separate **Remove shadow** checkbox either. A transparent drop shadow can be reduced by alpha cutoff; an opaque shadow or glow can only be flattened indirectly by denoise, palette reduction, and gradient step without semantic segmentation. Present those visible results in the Cleaned preview instead of claiming reliable shadow detection.

## 4. Canonical settings and mapping

The HTTP contract adds one optional, versioned object while preserving clients that send only `preset`:

```ts
interface VectorCleanupOptionsV1 {
  version: 1
  cleanup: 0 | 1 | 2 | 3 | 4
  colors: 3 | 4 | 6 | 8 | 16 | 32 | 64 | 128 | 'full'
  alphaCutoff?: number
  gradientStep?: number
  advanced?: {
    speckleSize?: number
    colorPrecision?: number
    pathSimplify?: number
  }
}
```

The public multipart request becomes:

```text
image=<binary>
preset=accurate|balanced|tiny|auto
cleanup=<JSON VectorCleanupOptionsV1>   # optional
```

The server parses and allowlists every value; it does not silently clamp invalid values. An absent object retains current behavior. An invalid object returns the existing generic validation response. Exact slider mappings belong in one `cleanup-presets.ts` module and are calibrated rather than distributed as component constants.

Initial calibration grid, not permanent product defaults:

| Cleanup level | Raster denoise | `filterSpeckle` direction | `simplify` direction |
|---:|---|---|---|
| 0 | off | preset value or lower | preset value or lower |
| 1 | off | low | low |
| 2 | very mild | moderate | moderate |
| 3 | mild | high | high |
| 4 | strongest bounded value | highest tested | highest tested |

Use discrete levels because kernel sizes and region counts are discrete or strongly nonlinear. The UI may animate continuously, but the request sends a stable level. Do not publish a formula such as `slider * 1.28` as a quality model.

## 5. Preprocessing semantics

Operation order is fixed:

```text
decode
 -> auto-orient
 -> crop in orientation-corrected normalized coordinates
 -> optional no-upscale resize (if later exposed in Vector mode)
 -> normalize to sRGB and 8-bit working depth
 -> optional bounded edge-preserving denoise
 -> optional alpha cutoff and transparent-RGB normalization
 -> optional adaptive palette quantization with dithering off
 -> strip metadata
 -> lossless intermediate
```

Rules:

- Reuse the raster feature's normalized crop rectangle and orientation semantics. Do not invent a second coordinate system.
- Compare a tiny median, bilateral, and Kuwahara filter in the implementation spike. Ordinary Gaussian blur can widen edges and manufacture intermediate colors.
- Apply RGB cleanup with alpha-aware behavior so transparent edges do not gain black or white halos.
- Normalize RGB beneath fully transparent pixels before tracing. Hidden RGB must not create invisible color regions.
- Quantize adaptively with dithering disabled. Start with `sRGB`; test other spaces offline before changing the versioned mapping.
- Keep the intermediate lossless and in memory. It is input to VTracer, not a downloadable optimized raster.
- Record `preprocessMs`, resolved settings, and actual preprocessed unique-color count. `-colors 16` is a maximum/preference, not a guarantee of exactly 16 colors. Source-color counting is an offline calibration diagnostic because scanning a high-color photograph again on every request adds work without changing the result.

Select at most one raster denoise operator for production. If none consistently reduces SVG complexity without moving important edges, Cleanup level 2 may use VTracer-only filtering and leave raster denoise off.

## 6. Similarity and Auto Optimize

Preprocessing intentionally changes the image, so SVG Auto must use two references:

```text
original raster -- intentional edit --> cleaned raster
cleaned raster  -- vector fidelity  --> rendered SVG
```

- Candidate acceptance compares rendered SVG against the **cleaned raster**.
- Original-to-final similarity may be reported separately as an overall-change diagnostic, not the Auto acceptance score.
- The cleaned preview is the user's approval boundary for destructive color, alpha, and gradient changes.
- Selected Colors, alpha cutoff, and gradient step are constraints. Auto may search nearby speckle/simplify values but cannot override explicit choices.
- Phase A exposes cleanup only with Accurate/Balanced/Tiny. While Auto is selected, its current controls and original-raster reference remain unchanged and the cleanup panel is disabled with a short explanation. Phase C then preprocesses once, fixes the explicit Colors/alpha/gradient choices, and runs the existing bounded VTracer candidate family against that cleaned reference. Advanced speckle/simplify overrides remain unavailable in Auto because those are the dimensions Auto owns. Do not multiply the six candidates by every cleanup combination.

The optimization objective becomes:

```text
minimize serialized SVG bytes
subject to similarity(render(svg), cleanedRaster) >= calibrated gates
```

## 7. Post-vector cleanup

The safe post-vector stage initially consists of:

1. VTracer's `simplify`, while the tracer still knows fitted contours and junctions.
2. The existing conservative SVGO profile for syntax, precision, groups, attributes, and colors.
3. SVG parsing for path, command, element, and color statistics.

Do not delete paths using regex, DOM string length, bounding-box area, fill opacity, or color frequency. A small box can contain an important eye, punctuation mark, or logo symbol; a long thin path can have tiny area but essential geometry.

True `minPathArea`, near-color merge, point deletion, path merge, and layer merge remain SVG V3 mutations:

```text
parse -> mutate one candidate -> rasterize -> compare with cleaned reference
      -> keep only if every gate passes; otherwise roll back
```

This is the first point where **Min path area** can honestly be exposed. Until then, `filterSpeckle` is the supported small-region control.

## 8. UI and response design

The first UI increment stays compact:

```text
Original                         Vector Preview
+----------------------+        +----------------------+
| source raster        |        | rendered SVG         |
+----------------------+        +----------------------+

Crop / Select area (reuse existing normalized crop component)

Cleanup      Clean  --------o----  Detail
Colors           4  -------o-----  Full

[ Advanced Settings ]
[ Vectorize ]
```

Because lower Cleanup means more detail, accessibility text states the effect and level. The Colors control announces `Full` or its numeric maximum. Keyboard arrow keys move one discrete stop.

After conversion, add the cleaned palette count and preprocessing time beside existing paths, commands, vectorization time, and optimization time. Source color count belongs in the offline calibration report. A toggle may compare Original and Cleaned. The downloaded SVG must be the exact file shown in Vector Preview.

## 9. File boundaries and errors

Add vector-specific modules instead of coupling cleanup to raster output encoding:

```text
src/lib/vector/
  cleanup-types.ts
  cleanup-presets.ts
  preprocess-raster.ts
  resolve-options.ts
  vtracer.ts
  svgo.ts
  auto-optimize.ts
```

`preprocess-raster.ts` reuses the safe ImageMagick spawn helper, limits, cancellation, and generic logging policy. It does not reuse JPEG/WebP quality, PNG compression, or raster download naming.

The route flow remains readable:

```ts
const cleaned = await preprocessForVector(image, cleanup, signal)
const vectorized = vectorizeImage(cleaned.image, resolvedVTracerOptions)
const optimized = optimizeSvg(vectorized.svg)
const stats = analyzeSvg(optimized.svg)
```

Internal failures keep the client message `Conversion failed.` The server logs one structured error with request ID and original exception. Do not add a cleanup-specific exception hierarchy, retries, or stage taxonomy.

## 10. Delivery sequence

### Phase A — measurable preprocessing

1. Add optional typed cleanup request/response fields without changing old requests.
2. Add deterministic ImageMagick preprocessing and argument-construction tests.
3. Add Cleanup and Colors plus resolved values in Advanced.
4. Add cleaned palette count and preprocessing time; keep source counting in offline calibration.
5. Verify transparent edges, noisy JPEG art, glow/shadow art, gradients, logos, and small text.
6. Keep cleanup disabled in Auto until Phase C supplies the correct cleaned-raster quality reference.

Implementation status (2026-08-27): Phase A is implemented for Accurate, Balanced, and Tiny. The API accepts an optional versioned cleanup object; requests without it retain the legacy path. The UI exposes Cleanup, Colors, and the safe Advanced controls, while `minPathArea` is visibly deferred. ImageMagick performs auto-orient, bounded median cleanup when selected, alpha cutoff, no-dither palette reduction, transparent-RGB normalization, and lossless PNG handoff. The response reports preprocessing time and the actual cleaned palette count. Auto deliberately retains its previous pipeline until Phase C.

### Phase B — crop and intentional-edit preview

1. Reuse normalized crop selection in Vector mode.
2. Show an Original/Cleaned toggle using EXIF-corrected coordinates.
3. Add alpha cutoff and gradient step after preview behavior is clear.

### Phase C — Auto integration

1. Make cleaned raster the candidate-quality reference.
2. Keep explicit cleanup choices fixed during search.
3. Recalibrate the SVG V2 gate and candidate grid on the expanded corpus.

### Phase D — experimental mutations

Implement quality-gated `minPathArea` and other path mutations only if Phase A–C measurements show that VTracer simplification plus SVGO leaves a material complexity problem.

## 11. Acceptance criteria

- Existing requests with only `image` and `preset` retain their setting behavior.
- Colors uses adaptive quantization with dithering disabled and no second uncontrolled VTracer quantization.
- Cleanup reduces paths/commands on noisy fixtures without silently removing required high-contrast features.
- Transparent edges have no new halo on white, black, and checkerboard backgrounds.
- EXIF-oriented crop coordinates match the cleaned result.
- `Full` bypasses ImageMagick palette quantization.
- Advanced values resolve from and reset to one canonical configuration.
- Auto compares candidates to the cleaned reference and cannot override explicit destructive-edit settings.
- Post-vector cleanup is limited to VTracer simplify and conservative SVGO until a rasterized rollback gate exists.
- Preview and downloaded SVG are identical.
- ImageMagick time, output, memory, and cancellation limits remain enforced; client errors remain generic.

## 12. Non-goals for this increment

- semantic or ML background removal
- semantic shadow or glow detection
- true SVG gradient reconstruction
- general photo restoration or super-resolution
- arbitrary user-supplied ImageMagick arguments
- path deletion without render-and-compare rollback
- a second Python or tracing runtime
- exhaustive Auto search across every advanced control
