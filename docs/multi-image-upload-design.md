# Multi-image Upload and Batch Processing Design

Status: Multi-image R1 implemented; real-browser verification and client-side ZIP remain deferred  
Updated: 2026-08-27  
Scope: multiple PNG/JPEG/WebP inputs for raster optimization and SVG vectorization

## 1. Decision

Implement multi-image upload as a **browser-owned sequential queue over the existing single-image APIs**.

```text
select or drop multiple files
        |
        v
validate and create local batch items
        |
        v
freeze shared settings for this run
        |
        v
file 1 -> existing authenticated API -> result 1
file 2 -> existing authenticated API -> result 2
file 3 -> existing authenticated API -> result 3
        |
        v
per-file preview, status, metrics, and download
```

Do not add `/api/v1/vectorize-batch`, `/api/v1/optimize-raster-batch`, a server queue, background jobs, polling, or permanent result storage.

This is the smallest architecture that fits the current application:

- the existing routes already provide validation, authentication, request IDs, resource limits, conversion, and output metadata;
- the server admits one expensive job by default and immediately returns `429` when capacity is occupied;
- one file per request isolates validation and conversion failures;
- the current multipart parser buffers one bounded request before processing, so combining many 10 MiB inputs would multiply peak memory;
- raster and vector responses have different shapes and should retain their current contracts;
- cancellation can stop the active request without discarding completed results;
- external API callers can obtain the same batch behavior by making repeated normal requests.

The standard file input `multiple` attribute and drag-and-drop `DataTransfer.files` already expose multiple `File` objects. Copy them immediately into a normal array; do not retain the browser-owned `FileList` as application state.

## 2. Scope and limits

Multi-image R1 includes:

- selecting multiple files in the native picker;
- dropping multiple files at once;
- appending another selection to the current list;
- preserving selection order;
- per-file validation, removal, status, result, retry, and download;
- one shared vector preset/cleanup configuration;
- one shared raster compression/resize configuration;
- one independent normalized crop rectangle per raster file;
- sequential authenticated requests;
- batch progress and stop/resume behavior;
- partial success: one failed file does not discard successful files;
- deterministic object-URL cleanup;
- Korean user-facing copy.

Initial browser limits:

| Limit | Value | Reason |
|---|---:|---|
| files per batch | 10 | bounds UI, output memory, and total processing time |
| bytes per file | 10 MiB | preserves the existing server contract |
| aggregate input bytes | 50 MiB | prevents a picker action from retaining an unexpectedly large set |
| active client requests | 1 | matches the default server conversion permit |

Accept valid files in their supplied order until either batch limit is reached. Reject each invalid or excess file independently and show one summary such as `7개 추가 · 2개 제외`. Do not reject the entire selection because one file is invalid.

Files with the same name are distinct inputs and must not be silently deduplicated. Each item receives a client-only `crypto.randomUUID()` identifier. Directory upload, recursive traversal, paste upload, URL import, animated images, and PDF/document batching are outside R1.

## 3. API and concurrency contract

No server API change is required for the first implementation.

For each file, call exactly one existing route:

```text
POST /api/v1/vectorize
POST /api/v1/optimize-raster
```

Every call includes the same required `Authorization: Bearer <key>` header. A successful request for one item does not authenticate later items. Preserve the response request ID, selected preset, metrics, bytes, dimensions, and download name on that item.

The UI must run one request at a time even if `OHMYIMG_MAX_CONCURRENT_JOBS` is configured above one. The browser cannot reliably know remaining capacity, and automatic parallelism would compete with another tab or external API client. Parallel batch execution may be reconsidered only after measured throughput and peak-memory evidence, with a maximum of two client requests and no change to server safety limits.

Do not add automatic conversion retries. Queue handling by response class is:

| Result | Queue behavior |
|---|---|
| success | store result and continue |
| normal validation or processing failure | mark only this item failed and continue |
| `401` | stop the queue, invoke the existing unauthorized UI, leave remaining items queued |
| `429` | return the active item to queued, stop the queue, show the busy message and manual resume action |
| user stop/abort | mark the active item cancelled, retain completed results, leave unstarted items queued |

The `Retry-After` header may be displayed as guidance, but R1 does not start a timer or retry in the background. This retains the project's simple error policy and avoids repeated work when another client owns the single permit.

## 4. Batch item state

Use one discriminated status and keep the model local to the image workspace layer:

```ts
type BatchItemStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

interface ImageBatchItem<TResult> {
  id: string;
  file: File;
  status: BatchItemStatus;
  dimensions?: { width: number; height: number };
  result?: TResult;
  error?: string;
  requestId?: string;
}

interface RasterBatchItem extends ImageBatchItem<RasterResultData> {
  crop: NormalizedCrop;
}
```

Keep the common item fields small and add crop only to raster items. Do not add placeholder fields that one workspace cannot use, and do not create a generic job framework, observable store, event bus, or persistent queue.

Use a small reducer or functional `setState` updates so a late response can update only the matching item ID. Never close over an array index: removals change indexes while request results still refer to the original item.

At **Process all**, take a settings snapshot for the run and disable settings, crop editing, adding files, and removal until the queue stops. This prevents a displayed global setting from diverging from in-flight results. Changing shared settings while idle invalidates all existing results. Changing one raster crop invalidates only that item's result.

One `AbortController` owns the active request. Stopping a batch aborts that controller and prevents the loop from starting another item. Starting a new run creates a new run ID so a late completion from an older run cannot mutate the current list.

## 5. Upload and list UI

Replace the single selected-file presentation with a compact batch workspace:

```text
┌──────────────────────────────────────────────┐
│ 이미지를 여기에 놓으세요                    │
│ PNG / JPEG / WebP · 파일당 10MB · 최대 10개 │
│                  [이미지 선택]              │
└──────────────────────────────────────────────┘

3개 파일 · 8.4MB                 [전체 제거]

✓ logo.png       완료       84KB → 21KB  [보기]
● photo.jpg      처리 중                 [중지]
○ banner.webp    대기                     [제거]
! bad.png        실패 · 요청 ID …        [재시도]
```

Requirements:

- set `multiple` on the hidden file input;
- process every file in `input.files` or `dataTransfer.files`, not only index `0`;
- retain the existing MIME/extension pre-check as a convenience while the server remains authoritative;
- announce added/rejected counts and queue progress through a polite live region;
- expose status with text and icon, not color alone;
- keep an explicit remove button with the filename in its accessible label;
- show total input bytes and item count before starting;
- do not render ten full-size previews simultaneously.

The current `ImageDropzone` may be changed to an array-based contract used by both image workspaces. Do not preserve both single-file and multi-file prop modes unless another real caller needs the old contract.

## 6. Raster-specific crop behavior

Every new raster item starts with the existing full-image normalized crop:

```ts
{ x: 0, y: 0, width: 1, height: 1 }
```

The list has one active item. Selecting **보기/자르기** loads that file into the existing crop viewport and restores its own percent crop. Crop coordinates remain in the orientation-corrected normalized space already defined by Raster R1.

Shared settings apply to every item:

- High/Balanced/Small/Auto mode;
- Raster R3 policy when implemented;
- maximum width and height.

Crop remains per item because applying one rectangle to images with different aspect ratios is rarely meaningful. Provide **모두 전체 이미지로 설정** as an explicit bulk action, but do not add “copy this crop to all” in R1.

The active preview is the only full-size input preview. The list may use small constrained thumbnails. Natural dimensions are loaded per item when needed; processing does not wait for every thumbnail to decode because the server validates dimensions independently.

## 7. Vector-specific behavior

Vector mode has no per-file editing in the current implementation. Accurate/Balanced/Tiny/Auto and cleanup settings are one shared batch snapshot.

Each successful row reports SVG bytes, paths, commands, colors, timing, and similarity values when Auto supplies them. Selecting a row displays its original and SVG preview using the existing result components. Do not keep all SVG markup mounted in the document at once.

Vector cleanup remains disabled for Auto until the separate cleaned-reference phase is implemented. Multi-upload must not alter that pipeline rule.

## 8. Results and downloads

R1 provides an individual **다운로드** action for every successful item. The downloaded bytes and filename must come from that item's actual API result. A failed or cancelled item has no download action.

Do not trigger ten synthetic anchor clicks from one button. Browsers may gate multiple automatic downloads, and it provides poor partial-failure feedback.

Add **성공한 결과 ZIP 다운로드** in a second increment after the queue itself is verified. Build the archive in the browser from already-returned result blobs; do not upload results again and do not create a server archive route. `fflate` is the preferred candidate because it supports browser ZIP generation and streaming with a small focused import. Use ZIP `STORE` for PNG/JPEG/WebP, which are already compressed, and optional DEFLATE for SVG text.

ZIP rules:

- include succeeded items only and state the included count;
- use the server-sanitized result filename as the base;
- resolve collisions deterministically as `name (2).ext`, `name (3).ext`;
- name the archive `ohmyimg-results.zip`;
- run creation only from an explicit user action;
- surface one generic archive error without changing individual results;
- revoke the archive object URL after download.

Do not add `fflate` until the individual-download batch flow is complete. If ten-result ZIP creation causes unacceptable browser memory on the boundary corpus, retain individual downloads instead of moving archive creation to the server.

## 9. Browser memory and cleanup

Input `File` objects and successful output `Blob` objects remain browser-owned for the lifetime of the batch. Keep the initial limits small and avoid converting either to base64.

Create object URLs in stable per-item preview components or one active-preview component. Revoke each URL when:

- its file or result is replaced;
- its item is removed;
- all items are cleared; or
- the workspace unmounts.

Removing a completed item must release both input and output references. Changing shared settings may revoke obsolete output URLs and discard output blobs immediately. The browser's `URL.revokeObjectURL()` is the required lifecycle operation; do not rely only on page navigation cleanup.

## 10. Error and logging policy

Keep errors item-scoped and concise:

```text
photo.jpg
이미지 처리 중 오류가 발생했습니다.
요청 ID: 7c…
```

The client does not parse ImageMagick, VTracer, or SVGO diagnostics. Detailed failures remain in the existing server logs under the per-request ID. The batch itself needs no new server log record because it is a client concept; optional client-only run IDs must not replace request IDs.

Show a completion summary:

```text
완료 7 · 실패 1 · 취소 0 · 대기 2
```

Do not collapse partial success into a global failure banner. A global banner is reserved for authentication, server-busy, or queue-control state that affects remaining items.

## 11. Verification plan

### 11.1 Unit and component tests

- picker and drop both add every supplied file;
- mixed valid/invalid selections accept valid items and report exclusions;
- 10-file and 50 MiB aggregate limits are deterministic;
- duplicate filenames remain separate items;
- result updates are keyed by item ID, not array position;
- processing is strictly sequential;
- one item failure continues to the next;
- `401`, `429`, and user abort stop without losing successful results;
- retry affects only the selected item;
- settings snapshots cannot change during a run;
- shared setting changes invalidate every result;
- one crop change invalidates only its raster item;
- object URLs are revoked on replacement, removal, clear, and unmount;
- collision-safe ZIP names are deterministic when ZIP support is added.

### 11.2 Route and integration tests

Existing single-file Route Handler tests remain authoritative. Add one client integration test that proves a three-file batch issues three authenticated requests in order and maps each response/request ID to the correct item. Do not duplicate codec and vectorization fixture matrices under a batch endpoint that does not exist.

### 11.3 Real-browser checks

- select and drop multiple files on desktop;
- add a second selection without losing the first;
- operate the list and active crop editor using keyboard and mobile viewport;
- process mixed PNG/JPEG/WebP batches;
- stop during an Auto request and resume remaining files;
- verify partial failure and manual retry;
- compare every preview with its downloaded file;
- verify memory is released after removing results and clearing the batch;
- verify the later ZIP contains the exact successful outputs and collision-safe names.

## 12. Implementation sequence

1. Extract reusable file validation and add the array-based multi-file dropzone.
2. Add the bounded batch item model and list UI without processing changes.
3. Convert vector mode to the sequential queue using the existing API and results.
4. Convert raster mode, preserving one normalized crop per item and shared resize/encoding settings.
5. Add stop, resume, per-item retry, progress, and partial-success summaries.
6. Add object-URL lifecycle tests and real-browser verification.
7. Add client-side ZIP only after individual downloads are stable.

This order uses vector mode as the simpler queue integration before introducing raster's per-item crop state. It does not require backend, database, concurrency-gate, or conversion-core changes.

Implementation status (2026-08-27): the shared dropzone accepts and appends up to ten bounded files, both image workspaces maintain ID-keyed per-file status and results, and both call their unchanged authenticated APIs sequentially. Vector settings are shared across the run. Raster settings are shared while normalized crops and natural dimensions remain per item. Stop, manual resume, per-item retry, partial success, selected-item preview/download, duplicate filenames, and object-URL replacement are implemented. `401`, `429`, and `503` stop the remaining queue; ordinary item failures continue.

The batch-selection unit tests cover order, duplicates, mixed rejection, per-file size, total size, and item-count limits. The repository has 124 passing tests, TypeScript and ESLint pass, and a Next.js 16.3.2 Webpack production build succeeds. The default Turbopack build could not complete in the current execution environment because its CSS worker was prohibited from binding a local port; it did not report a source compilation error. Formal pointer, keyboard, mobile, stop/resume, preview/download, and browser-memory checks are not claimed complete. No ZIP dependency or archive code has been added.

## 13. Primary references

- [WHATWG HTML file upload state](<https://html.spec.whatwg.org/multipage/input.html#file-upload-state-(type=file)>)
- [MDN `FileList`](https://developer.mozilla.org/en-US/docs/Web/API/FileList)
- [MDN `DataTransfer.files`](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files)
- [MDN using files from web applications](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications)
- [MDN `URL.revokeObjectURL()`](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
- [`fflate` official repository](https://github.com/101arrowz/fflate)
- [Node.js `child_process.spawn()`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
