# Implementation Review — 2026-08-23

## Outcome

The raster R1/R2 and SVG V1/V2 implementation is structurally sound after review. Eight correctness or verification gaps were found and fixed. No unresolved high- or medium-severity code finding remains. Formal real-browser interaction verification is deferred.

## Findings resolved

### 1. Auto candidate files bypassed the 32 MiB output cap

Manual output was bounded while streaming stdout, but Raster R2 candidates were written to request-local files and read directly into memory. A high-entropy candidate could therefore consume substantially more memory than the documented output limit.

`readMagickOutputFile()` now checks the regular-file size before reading and verifies the resulting buffer again. Auto candidates use this bounded reader. A regression test proves that an oversized candidate is rejected before selection.

### 2. JPEG and WebP discarded ICC profiles

The implementation used `+profile "*"` for JPEG and WebP, which removes every embedded profile, including ICC. That contradicted the documented color policy and could change wide-gamut or CMYK appearance.

All three raster formats now use `+profile "!icc,*"` and remove comments separately. PNG also retains its format-specific non-rendering chunk exclusions. ImageMagick documents the negated glob as removing all profiles except the named profile. Local extraction checks proved that the 3,144-byte sRGB ICC payload survives JPEG and WebP re-encoding byte-for-byte, while the existing EXIF-orientation test proves that camera orientation metadata is removed.

### 3. Object URLs were created during React render

Creating object URLs inside `useMemo()` can leak a URL if concurrent rendering discards the render before its cleanup effect is committed. Moving the state update directly into an effect also violated the repository's React lint rule.

The hook now creates and replaces URLs only from file-selection or completed-request event handlers. It revokes the previous URL immediately and revokes the current URL on unmount.

### 4. Dynamic previews used a fixed 4:3 intrinsic ratio

The shared preview passed `1200 × 900` to `next/image` for arbitrary Blob URLs. That fixed intrinsic ratio could distort portrait or non-4:3 content.

The preview now uses `fill` inside the fixed preview viewport with `object-contain`, preserving the decoded image's actual aspect ratio.

### 5. Docker build did not execute the test suite

Local tests did not prove compatibility with the canonical Node/Alpine/ImageMagick combination.

The Docker builder now installs the same ImageMagick codec modules and runs `pnpm test` before `pnpm build`. The final runtime remains a separate non-root standalone stage.

### 6. Runtime user was not assigned to the intended group

The Dockerfile created a `nodejs` group and copied files with that group, but Alpine assigned the `nextjs` system user to `nogroup`. The user remained able to run the application because it owned the files, but the configuration did not match its intent.

User creation now explicitly sets `--ingroup nodejs`. The final container reports UID 1001 and GID 1001.

### 7. A scrollable crop viewport could leave the full-image crop unchanged

The crop started at 100% of the image inside a centered scroll container. On large images, edge handles could be outside the immediately usable area. Because the full-image selection could not move, an unsuccessful resize left the crop at 100%; the server then correctly performed a full-image crop followed by encoding, which looked like optimization without cropping.

The crop image now always fits within the viewport, so all four edges remain visible and selectable without an internal scroll coordinate space. The latest percent crop is stored synchronously and validated immediately before the request. The UI displays the selected natural-pixel dimensions, offers an explicit full-image reset, and clears stale output when crop, resize, or compression settings change.

A new regression test proves that a 50% center crop with resize disabled returns only the expected 12 × 12 decoded PNG pixels. A direct development-server request confirms the same dimensions and pixel signature.

### 8. Alpine could advertise SVG support while its delegate remained unusable

The initial SVG V2 implementation worked on macOS, but the canonical Alpine ImageMagick package exposed an SVG delegate configuration without installing the `rsvg-convert` executable. Installing that package revealed a second incompatibility in ImageMagick's stdin-to-delegate temporary-file handoff.

The Docker builder and runtime now install `rsvg-convert` explicitly. SVG Auto writes only its internally generated, sanitized SVG to the already isolated request directory and gives librsvg that stable filename. The directory and all MIFF intermediates are removed by the existing cleanup boundary. Docker tests now execute the complete six-candidate SVG Auto search.

## Verification evidence

- 72 Vitest assertions pass locally.
- The same 72 assertions pass in the Node 24 Alpine Docker builder.
- TypeScript checking and ESLint pass.
- Next.js 16 production build passes without bundler warnings.
- Production dependency audit reports no known vulnerabilities.
- The production container is healthy and runs as `nextjs`.
- Manual PNG, JPEG, and WebP crop/resize requests return valid 8 × 8 same-format outputs.
- JPEG Auto evaluates seven candidates and returns SSIM/MAE metadata.
- Invalid raster input returns HTTP 400 without ImageMagick diagnostics.
- Existing PNG-to-SVG conversion still returns an optimized SVG.
- SVG Auto evaluates six candidates and returns versioned SSIM, pixel-MAE, and edge-MAE metadata.
- The standalone runtime contains JPEG, PNG, and WebP read/write delegates plus `rsvg-convert` 2.62.3.

## Deferred browser verification

The owner performed an informal browser pass and deferred the formal checklist. The automated browser provider returned no available browser instances. The following checks remain recorded for later:

- pointer and keyboard crop manipulation;
- browser EXIF-corrected preview orientation;
- Blob preview rendering after the API response;
- download filename and downloaded bytes.

These checks require a connected in-app browser or Chrome instance. They cannot be proven by HTTP, unit, or server-rendered HTML checks.

## Verification addendum — 2026-08-24

The 72-assertion result above remains the historical snapshot for this 2026-08-23 review. The current shared repository suite contains 120 passing tests after later API-access, calibration-runner, bounded multipart, child-environment isolation, document-to-PDF, associated-alpha metric, animated-vector-input, child-cancellation, process-tree cleanup, and vector-cleanup work. The additional tests extend repository coverage; they do not retroactively change the review's original count or satisfy the deferred real-browser checklist.

## References

- [ImageMagick command-line profile option](https://imagemagick.org/command-line-options/#profile)
- [ImageMagick embedded image profiles](https://imagemagick.org/formats/#embedded)
- [Node.js child processes](https://nodejs.org/api/child_process.html)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [React Image Crop](https://github.com/dominictobias/react-image-crop)
