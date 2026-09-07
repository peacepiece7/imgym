# P0 review and P1/P2 implementation record

- Reviewed: 2026-09-06
- Status: P0 defects fixed; bounded P1/P2 R1 recipes implemented
- Product boundary: private, self-hosted, single-owner, no durable asset storage

## Outcome

The product now has two handoff layers rather than a collection of unrelated editors.

1. **Web Asset Pack R1** inspects static raster images and ships responsive, quality-gated web files, code, and a deterministic manifest.
2. **Asset Recipe R1** applies one bounded recipe to one source and ships the output files, platform contracts, warnings, and SHA-256 records in a streamed ZIP.

The UI keeps the P1 and P2 recipes in one `에셋 레시피` workspace. The recipe contract owns the platform details; users do not submit arbitrary ImageMagick, FFmpeg, SVGO, or FontTools arguments.

## P0 review

| Finding | Risk | Resolution | Evidence |
|---|---|---|---|
| AVIF color detection searched arbitrary encoded bytes for `prof` and `nclx` | compressed payloads could falsely claim an ICC/CICP property | parse bounded ISO BMFF boxes and accept color methods only from nested `colr` boxes | unit regression recognizes `meta/iprp/ipco/colr` and rejects the same markers inside `mdat` |
| `Web safe` used `-colorspace sRGB` and then removed profiles | Display P3 pixel values could be relabeled instead of color-managed | embedded ICC inputs now use a real source-to-sRGB `-profile` transform with relative intent and black-point compensation; CICP-only inputs fail conservatively | owner Display P3 sample: correct transform versus naive profile removal RMSE `671.629 (0.0102484)`; HTTP pack returned 200 and a 320×230 output with no ICC/CICP |

The canonical Alpine image installs `colord` and uses `/usr/share/color/icc/colord/sRGB.icc`. The macOS development fallback uses the system sRGB profile. This follows ImageMagick's distinction between assigning a profile and converting between two profiles in its [color management guidance](https://imagemagick.org/color-management/).

## P1 delivered

| Prioritized capability | R1 implementation | Verification |
|---|---|---|
| Direct SVG optimization and safety | bounded 2 MiB direct-SVG route; keeps `title`, `desc`, valid dimensions, safe CSS, gradients and internal fragment references; removes scripts, unsafe/external styles, event handlers, external references, images and `foreignObject`; never inserts uploaded markup into the DOM | owner 1.34 MiB SVG returned 200 without destructive changes; style-based Mermaid SVG fell from 49,593 to 43,370 bytes with render RMSE `0.00083901`; malicious fixtures verify every removal class |
| Framing and manual focus | 90° rotation, both flips, transparent trim, 0–256 px pad, six aspect ratios, one reusable X/Y focus contract | owner PNG produced square, hero and portrait crops plus focus JSON and LQIP |
| Web icons | favicon, 192/512 PWA, Apple touch, maskable and monochrome variants, manifest and Next.js names | owner PNG pack returned 21 ZIP entries with optional native outputs |
| Visual comparison | representative-output API plus source/output slider with role, dimensions, and bytes | component and response contracts build successfully; live browser automation was unavailable in this environment |
| Palette and contrast | 3–8 quantized colors, CSS variables, swatch, all color-pair ratios with AA/AAA/UI flags | real raster rendering and JSON/CSS tests pass |
| OG/social card | fixed 1200×630 PNG/JPEG, bounded title/subtitle, required human-authored `og:image:alt`, Open Graph markup and Next.js names | Korean/Latin owner card returned 200 |
| CLI/CI audit | local recursive or `--changed` scan, byte/pixel budgets, forbidden formats, EXIF/XMP/GPS markers, SHA-256 exact duplicates, JSON report and non-zero failure code | duplicate fixture returned exit 1, one failed item and one duplicate group |
| HEIC input | strict HEIF brand check; SDR 8-bit first-frame decode to JPEG and WebP | owner-derived HEIC returned 200 and a valid ZIP |

The icon pack is based on the current [Web App Manifest image resource model](https://www.w3.org/TR/appmanifest/), [Apple app-icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/), and [Android adaptive icon guidance](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive). The maskable output forces at least 20% inset; the native option emits one iOS 1024 source and Android legacy/adaptive/monochrome handoff files.

## P2 delivered with explicit ceilings

| Capability | Included R1 | Deliberate ceiling |
|---|---|---|
| GIF replacement | VP9 WebM, H.264 MP4, PNG poster and accessible source-order HTML | GIF input only; muted loop; maximum 30 seconds and 30 fps; no timeline, audio, or general video input |
| Web font | TTF/OTF/TTC/WOFF/WOFF2 to WOFF2 subset, CSS and Unicode range | explicit modification/embedding-rights confirmation; maximum 5,000 input characters; no license inference or automatic fallback-font design |
| Placeholder | 32 px quality-reduced WebP in framing, palette and social packs | reuses the P0 LQIP path; no BlurHash dependency; Next.js static imports are not duplicated |
| Watermark | bounded text, five positions, color and opacity | text only; no arbitrary SVG/HTML overlay or compositing language |
| Background removal | configurable solid-color similarity to transparent PNG | global color match only; not semantic or AI background segmentation |
| DAM/CDN handoff | portable, versioned manifest with paths, MIME, bytes and hashes | no upload persistence, sharing, access control, billing, or vendor-specific mutation |
| Native icons | optional iOS asset-catalog source and Android density/adaptive files | versioned generated handoff; no Xcode/Gradle project mutation |
| Inventory and duplicates | exact SHA-256 groups in the CI audit | no perceptual similarity threshold or likely-duplicate UI |

The media choices follow [web.dev's GIF replacement pattern](https://web.dev/articles/replace-gifs-with-videos), the [WOFF2 specification](https://www.w3.org/TR/WOFF2/), and [FontTools subsetting options](https://fonttools.readthedocs.io/en/stable/subset/index.html). Palette flags use WCAG 2.2 thresholds: 4.5:1 normal text, 3:1 large text/UI, and 7:1 AAA, as specified in [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Safety and runtime boundaries

- Every route authenticates before reading multipart bytes and shares the single-job admission gate.
- ImageMagick, FFmpeg, and FontTools run without a shell, in a request-specific directory, with a minimal environment, process-group cancellation, a 60-second media timeout, and bounded diagnostics.
- Raster and recipe inputs retain byte, dimension, and decoded-pixel ceilings. HEIC is explicitly SDR-only; GIF is duration/fps bounded.
- ZIP names are server-generated and traversal-checked; entry count and total uncompressed bytes remain bounded.
- Source and temporary outputs are removed after response completion or cancellation. No DAM storage was introduced.

## Verification record

| Layer | Result |
|---|---|
| Unit/process/route tests on local host | 177 passed; the GIF codec test skipped because the host Homebrew FFmpeg has a missing `libvpx` dynamic library |
| Next.js 16 production build | passed; 14 routes generated |
| Node 24 Alpine Docker build | 178 passed, including Noto CJK WOFF2, FFmpeg codec, safe-CSS/marker SVG, monochrome alpha, and MP4 background-pixel regressions; production build completed |
| Docker GIF HTTP flow | 200; valid ZIP; VP9 WebM and H.264/yuv420p MP4 verified by container FFprobe; transparent-corner MP4 decoded to warm background RGB `239,237,226` for requested `#f1ede3` after codec conversion |
| Owner asset HTTP flows | P3 Web safe, frame, icons, palette, social, direct SVG, HEIC, solid background, and watermark all returned 200 |
| Browser automation | blocked by environment: neither the required browser CLI nor a connected browser instance was available; no visual-pass claim is made |

The remaining release action is one human/browser pass over the new workspace at desktop and 390 px width, especially focus placement, icon legibility at 48 px, Korean OG line wrapping, comparison-slider drag behavior, and streamed save/cancel behavior.
