# Maintenance

## Change map

Start from the user-visible behavior, then edit the narrowest owner.

| Change | Primary location | Usually verify with |
| --- | --- | --- |
| Top-level navigation or API-key UI | `src/components/image-workspace.tsx`, `src/hooks/use-local-api-key.ts` | lint, browser keyboard/mobile pass |
| Workflow form, preview, batch state | matching `src/components/*-workspace.tsx` | route tests plus browser flow |
| HTTP fields, status, headers | matching `src/app/api/v1/**/route.ts` | access/route regression tests |
| Authentication, base path, multipart, admission | `src/lib/api/` | `src/lib/api/access.test.ts`, every affected route |
| Static raster rules | `src/lib/raster/` | `src/lib/raster/raster.test.ts` |
| Vector tracing/SVG rules | `src/lib/vector/` | `src/lib/vector/vector.test.ts` plus render comparison |
| Responsive packs and ZIP | `src/lib/web-assets/` | `src/lib/web-assets/web-assets.test.ts` |
| Icons/palette/social/media/font recipes | `src/lib/asset-recipes/` | both asset recipe test files |
| Markdown/PDF semantics | `src/lib/document/`, `scripts/render-document-pdf.py` | document tests and Poppler assertions |
| Native package or runtime | `Dockerfile` | clean Docker build and runtime smoke |
| Domain, path, port, timeout | `next.config.ts`, `compose.yml`, `deploy/`, deployment guide | private/public health plus one conversion |

Route files should remain adapters: authenticate, admit, parse, call a library, shape a response, and clean up. Transformation logic belongs in `src/lib/**`; browser orchestration belongs in components/hooks.

## Before changing Next.js code

This repository uses Next.js 16.3.2 and carries an explicit agent warning in `AGENTS.md`. Read the relevant installed guide under `node_modules/next/dist/docs/` before editing framework behavior. Do not assume older Next.js conventions.

## Non-negotiable review checklist

### Input and API

- Authenticate before parsing or decoding.
- Add new multipart fields to an explicit allowlist and decide whether duplicates are legal.
- Bound encoded bytes, decoded dimensions/pixels, text length, element count, and generated output as relevant.
- Detect file structure/signature; never trust extension or declared MIME alone.
- Keep client errors short and include a request ID for internal failures.

### Native processes

- Use `spawn`-style argument arrays with `shell: false`.
- Allowlist every user-controlled option before it reaches native arguments.
- Set time, stdout/stderr, filesystem, and output-size bounds.
- Propagate request cancellation and terminate the process group/delegates.
- Keep only the environment variables the child actually needs.

### Files and streams

- Use request-scoped temporary directories.
- Make cleanup idempotent and cover success, error, disconnect, and cancellation.
- Validate generated ZIP paths, duplicates, entry count, and total uncompressed bytes.
- If a response stream owns files or a job permit, transfer cleanup ownership only after stream creation succeeds.
- Do not introduce persistence under the name of a manifest or preview.

### Image/SVG correctness

- Preserve EXIF display-space crop semantics.
- Treat ICC, CICP, alpha, animation, and metadata as separate properties.
- Assigning a color profile is not the same as converting between profiles.
- Compare decoded pixels after all transforms; file bytes alone are not a quality metric.
- Keep quality-gate versions in responses/manifests when thresholds or metrics change.
- Never inline untrusted SVG; retain the direct-SVG safety fixtures when changing SVGO.

### UI

- Revoke replaced/unmounted Blob URLs.
- Preserve keyboard operation, visible focus, labels, status announcements, and mobile layout.
- Keep per-file state independent so one batch failure does not erase successful results.
- Report whether ZIP saving streamed to disk or used the memory fallback.

## Definition of done

Minimum for documentation-only changes:

```sh
git diff --check
# check relative Markdown links
```

Minimum for TypeScript or UI changes:

```sh
pnpm lint
pnpm test
pnpm build
git diff --check
```

Add a clean Docker build when native tools, Next.js output, route behavior, cancellation, fonts, codecs, SVG rendering, PDF, or production configuration changes. Add an authenticated real-file HTTP check for the affected workflow. Add a browser pass when interaction, preview, saving, responsive layout, keyboard behavior, or Blob lifecycle changes.

Synthetic fixtures guard regressions but do not replace owner review of representative photos, logos, transparent assets, Korean copy, fonts, HEIC, and animation.

## Documentation lifecycle

| Document kind | Rule |
| --- | --- |
| Root `README.md` | Korean, concise, user-facing orientation and quick start. |
| `docs/wiki/*.md` | English, current-state system memory; update with code. |
| Design/how-to files in `docs/` | Deep contract and rationale; update only while they remain current. |
| `*-YYYY-MM-DD.md` reviews | Immutable historical evidence; add a new record instead of rewriting history. |
| `docs/papers/` | Unchanged source material; interpretation belongs in a design document. |

When a page grows, first remove repeated prose and link to the authoritative page. Split only when two readers have clearly different tasks. Avoid a second navigation hierarchy, generated docs site, or wiki synchronization until repository Markdown is measurably insufficient.

## Decision log

### D001 — Repository-native wiki

- **Status:** accepted, 2026-09-07.
- **Context:** project knowledge was spread across a long README and detailed design/review documents, making current shape hard to recover.
- **Decision:** keep a compact English living wiki under `docs/wiki/`, a Korean root README, and dated records as evidence.
- **Consequences:** documentation and code can change in one review; no separate GitHub Wiki sync or publishing system is required. Maintainers must update the current-state page when contracts move.

### D002 — Single self-hosted process, no durable asset storage

- **Status:** current product boundary.
- **Rationale:** this is an owner-operated transformation tool, not an account system or DAM. Request-local processing minimizes privacy, operations, and cleanup complexity.
- **Revisit when:** more than one replica, multiple users, durable jobs, shared rate limits, or stored asset URLs become concrete requirements.

### D003 — Docker is the verification authority

- **Status:** accepted.
- **Rationale:** host ImageMagick/FFmpeg/Python installations vary, while the deployable image pins the OS family and installs every required delegate. The Docker builder runs tests before producing the application.
- **Consequence:** a host-only pass cannot close a codec, font, SVG-rendering, or PDF-runtime change.

### D004 — Bounded recipes instead of general editors

- **Status:** accepted product rule.
- **Rationale:** allowlisted recipes are explainable, testable, and safe to expose to native tools. General video, font, image-compositing, AI background, or DAM editors would multiply unbounded state and policy.
- **Revisit when:** repeated owner tasks show that a specific bounded extension is missing.

## Current debt and next evidence

1. Run the recorded desktop and 390 px browser acceptance pass for the newest Asset Recipe UI.
2. Calibrate quality gates against an owner-selected private corpus before widening candidate families.
3. Measure real recipe use before promoting any P2 ceiling into a general editor.
4. Keep old test counts in dated reviews labelled as historical; never copy them into current claims without rerunning verification.
