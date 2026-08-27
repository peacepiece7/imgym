# Quality Calibration Guide

## Purpose

OhMyImg must not treat one similarity number as the product definition of quality. The current Auto modes use provisional, versioned gates, and select the smallest candidate that passes them. Before changing those gates, collect repeatable evidence across a representative private corpus.

The calibration runner produces two artifacts:

- `report.json`: machine-readable sizes, timings, selected candidates, similarity values, and SVG complexity
- `contact-sheet.html`: original and processed outputs for human visual review

It calls the same authenticated HTTP endpoints as an external client. It does not bypass validation, concurrency limits, ImageMagick, VTracer, or SVGO, and it never writes the API key into either artifact.

Raster calibration uses the normalized full-frame crop and no resize so the run isolates encoding/vectorization quality. Crop geometry, EXIF alignment, and resize ordering remain a separate deferred UI checklist.

## Corpus design

Put PNG, JPEG, and WebP inputs under `calibration/corpus/`. Nested directories are treated as categories. Start with 20–40 carefully chosen images rather than hundreds of near-duplicates.

At minimum, cover:

| Category | Important failure modes |
| --- | --- |
| Photos | skin, hair, foliage, noise, gradients, low contrast |
| Logos/icons | transparency, sharp corners, flat colors, small holes |
| Illustrations | outlines, layered shapes, soft shading, color boundaries |
| Screenshots | small text, one-pixel rules, antialiasing |
| Geometry | circles, diagonals, repeated patterns, thin strokes |
| Input edge cases | EXIF rotation, very wide/tall images, tiny images, alpha |

Include explicit vector-cleanup stress cases: a transparent antialiased icon reviewed on three backgrounds, an illustration with a soft shadow or glow, a smooth gradient, and a JPEG-degraded logo with block or ringing artifacts.

Keep the corpus private if the images are private. Inputs and generated outputs remain local and are not committed by default; `calibration/output/` is ignored.

## Running a calibration

Use Node.js 24 and start OhMyImg with the same `.env` used by the runner:

```bash
pnpm dev
```

In another shell, run an Auto-only pass first:

```bash
pnpm calibrate -- --input calibration/corpus
```

The default server is `http://127.0.0.1:3000`. Override it when necessary:

```bash
pnpm calibrate -- --base-url http://127.0.0.1:3100
```

After the smoke pass succeeds, compare Auto with every user-facing preset:

```bash
pnpm calibrate -- --mode-set all
```

Useful bounded variants:

```bash
pnpm calibrate -- --pipeline raster --limit 10
pnpm calibrate -- --pipeline raster --raster-policy both --limit 10
pnpm calibrate -- --pipeline vector --timeout-ms 180000
```

Each invocation creates a new timestamped directory. Existing reports are never deleted or overwritten.

## Review protocol

Open `contact-sheet.html` and inspect at both fit-to-view and 100% scale. Review transparent outputs against light and dark backgrounds when transparency matters.

For each category, check:

1. silhouette and crop/orientation correctness
2. text, thin lines, corners, and small enclosed regions
3. faces, hair, gradients, texture, and banding
4. transparency edges and halos
5. whether the size reduction justifies visible simplification

Then use `report.json` to compare three dimensions together:

- visual similarity: SSIM/MAE and, for SVG Auto, edge MAE
- serialized output size in bytes
- SVG complexity: paths, commands, elements, and colors

Do not select a threshold by optimizing the average alone. A threshold is acceptable only if important category failures and worst cases are also acceptable.

## Current scope and limitation

This first runner records every public mode, the candidate selected by each Auto search, the versioned gate values, and individual processing failures. It does not yet expose every rejected internal Auto candidate. Therefore it is suitable for reproducibility, visual review, regression baselines, and comparing Auto against presets, but not yet sufficient for mathematically retuning the internal thresholds.

Before changing a quality gate, add bounded internal candidate telemetry to the core optimizer or a development-only harness, then record pass/fail distributions without expanding the public production response. Keep candidate failures in server logs; the user-facing API should retain its generic error contract.

## Decision rule

Keep the existing gate when the corpus evidence is inconclusive. When changing one, record:

- corpus revision or checksum
- old and new versioned gate values
- category-level regressions and improvements
- output-byte and complexity distributions
- reviewed contact sheet location
- a rollback condition

The target remains the smallest acceptable output, not the smallest output in isolation.

## Vector cleanup calibration

Vector cleanup intentionally changes the raster before tracing. Calibrate it as two linked comparisons:

1. **Intentional edit:** source raster versus cleaned raster, reviewed visually. This records how much shadow, glow, alpha, gradient, or noise the requested cleanup removed.
2. **Vector fidelity:** cleaned raster versus rasterized SVG. SVG Auto uses this comparison for candidate acceptance.

Do not reject successful shadow removal merely because the final SVG differs from the untouched source. Conversely, a high cleaned-to-SVG score does not prove that aggressive cleanup preserved the intended subject.

For each Cleanup level and Colors stop, record source/preprocessed unique colors, SVG bytes, paths, commands, preprocessing and vectorization time, SSIM/MAE/edge MAE, and a contact-sheet judgment. Test ImageMagick denoise candidates separately and select at most one production operator. Dithering remains disabled during palette reduction because its pixel patterns inflate vector region counts.

The detailed option contract, Auto-reference rule, and delivery sequence are in [Raster Cleanup and Vector Path Cleanup Design](./vector-cleanup-design.md).

## Raster R3 lossy-compression calibration

Calibrate aggressive raster encoding separately from vector cleanup. Raster R3 returns a downloadable same-format image, so dithering that is undesirable before tracing may still improve a palette PNG. Use the same transformed lossless reference for every candidate and include the current Standard winner in every comparison.

For PNG, separate the report into lossless and palette candidates. Record compression level, strategy/filter identity, palette limit, dithering mode, actual palette entries, alpha error, encoded bytes, and time. Review smooth gradients for banding, screenshots for text damage, and partial transparency on light, dark, and checkerboard backgrounds.

For JPEG, record quality, sampling factor, entropy optimization, and baseline/progressive encoding. For WebP, record quality, method, sharp-YUV, auto-filter, and alpha quality. Do not infer the winning codec configuration from its nominal quality number; compare decoded results and actual bytes.

The candidate table must include:

- encoded bytes and reduction versus the Standard winner;
- associated-alpha SSIM and MAE;
- edge-weighted error;
- direct alpha error when applicable;
- encode and metric duration;
- every gate result and the final selection reason.

Accept a new Smaller policy only when it has useful wins in relevant categories, its worst accepted artifacts pass manual review, and the bounded search stays within the existing request budget. A rejected aggressive candidate must fall back to Standard and must not turn a valid request into an error. The detailed candidate and API plan is in [Raster Crop and Optimization Design](./raster-crop-and-optimization-design.md#13-raster-r3--aggressive-same-format-optimization-plan).
