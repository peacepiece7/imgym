# OhMyImg Research Documents

- [Manual deployment at `dev.margins.cloud/imgym`](./manual-deployment.md)
- [Vectorization and optimization design](./image-optimization-design.md)
- [Raster cleanup and vector path cleanup design](./vector-cleanup-design.md)
- [Raster crop and optimization design](./raster-crop-and-optimization-design.md)
- [Multi-image upload and batch processing design](./multi-image-upload-design.md)
- [External API access design](./external-api-access-design.md)
- [Document to PDF design](./document-to-pdf-design.md)
- [Quality calibration guide](./quality-calibration-guide.md)
- [Implementation review — 2026-08-23](./implementation-review-2026-08-23.md)
- [Image Vectorization: a Review (arXiv:2306.06441v1)](./papers/2306.06441-image-vectorization-review.pdf)
- [Towards Layer-wise Image Vectorization (CVPR 2022)](./papers/ma-2022-layer-wise-image-vectorization.pdf)

The paper PDFs are stored unchanged. Their design implications and the SVG roadmap are recorded in the vectorization design. The vector cleanup document specifies no-dither palette reduction, noise/alpha/gradient controls, similarity-reference semantics, and safe post-vector cleanup. The raster document records the implemented crop, bounded Raster R2 pipeline, and initial opt-in Raster R3 quality-gated candidate search. The multi-image document specifies a browser-owned sequential queue over the unchanged single-file APIs, per-file raster crops, partial success, and deferred client-side ZIP output. The external API document records the implemented mandatory single-key, per-request access boundary. The document design records the implemented semantic Markdown-to-PDF pipeline, copy contract, pagination behavior, and process isolation.

## Current roadmap

The implemented baseline now consists of Multi-image R1, Raster R1/R2, SVG V1/V2, the single-key API, and Markdown-to-PDF V1. Remaining work is deliberately ordered as follows:

1. Run corpus calibration with owner-selected photos, logos, transparent assets, illustrations, and screenshots; retain the machine report and human-reviewed contact sheet before changing any quality gate.
2. Complete the recorded real-browser checks when a browser instance is available, including the previously deferred crop checklist, multi-image queue, and PDF upload/preview/download flow.
3. Calibrate the implemented vector-cleanup Phase A, then add its normalized crop/cleaned preview and cleaned-reference Auto integration.
4. Calibrate the initial Raster R3 Standard/Smaller implementation, record internal candidate telemetry, remove dominated combinations, and retain Standard as the fallback.
5. Add client-side ZIP for successful batch results only after individual batch downloads and memory behavior are verified.
6. Consider SVG V3 mutations, Potrace, cross-format WebP/AVIF output, DOCX/imported document assets, or API-key issuance only when calibration or a concrete private use case justifies the added path.

Corpus calibration and browser checks are evidence tasks, not missing production branches. Synthetic fixtures exercise regressions but cannot honestly replace the owner's visual acceptance decisions on representative private images.
