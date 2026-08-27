# External API Access Design

Status: implemented; server-side verification complete; formal browser pass deferred  
Reviewed: 2026-08-24

## 1. Decision

Add a small, versioned HTTP API protected by exactly one owner-managed API key. The key is mandatory: every conversion request, including requests made by the built-in UI, carries and verifies the same key.

```text
caller
  -> Authorization: Bearer <key>
  -> server verifies against OHMYIMG_API_KEY
  -> conversion is accepted or rejected
```

There is no login handshake, unlock session, cookie, or key-issuance endpoint. Authentication is stateless and is repeated on every protected request. There is also no safe way for the server to distinguish an honest same-origin UI request from a scripted request merely by inspecting `Origin`, `Referer`, or the URL. Therefore, **all conversion entry points** must enforce the same check. Adding a protected external route while leaving the current routes open would create an authentication bypass.

The canonical conversion routes will be:

```text
POST /api/v1/vectorize
POST /api/v1/optimize-raster
POST /api/v1/docs-to-pdf
```

These are application-relative Route Handler paths. The fixed self-hosted deployment adds the Next.js base path, so external callers use `/imgym/api/v1/...` and health is exposed at `/imgym/api/health`. The reverse proxy preserves that prefix; it does not create a second set of handlers.

The built-in UI uses these paths. The former unversioned `/api/vectorize` and `/api/optimize-raster` routes were removed rather than retained as unauthenticated aliases. The document workflow was introduced directly at its versioned path. There are no duplicate public adapters.

`GET /api/health` is the only public API exception because the container and reverse proxy need an unauthenticated readiness/configuration check. It never returns the key or detailed runtime configuration. When the mandatory key is absent or invalid at runtime, health returns a generic 503 unhealthy result so deployment mistakes are visible.

The complete access matrix is:

| Entry point | Request key | Result |
|---|---|---|
| `/` and static UI assets | not required | loads the client that asks the owner for the key |
| `GET /api/health` | not required | public 200/503 health signal; never performs conversion work |
| `POST /api/v1/vectorize` | required on every call | 401 before body parsing when missing or wrong |
| `POST /api/v1/optimize-raster` | required on every call | 401 before body parsing when missing or wrong |
| `POST /api/v1/docs-to-pdf` | required on every call | 401 before body parsing when missing or wrong |
| old unversioned conversion paths | not accepted | removed; normal 404 behavior |
| any future conversion or mutation API | required by default | a public exception requires an explicit design decision |

## 2. Scope and non-goals

This design is for one owner using a small self-hosted tool. The API key answers one question: may this caller run conversion or document-rendering work?

V1 includes:

- exactly one required server-configured key;
- Bearer authentication;
- per-request verification with no authenticated session;
- the raster, SVG, and Markdown-to-PDF operations;
- stable `/api/v1` paths;
- generic client errors and detailed bounded server logs;
- request admission control for CPU- and memory-intensive jobs;
- command-line examples and Docker runtime configuration;
- UI support for entering the same key and attaching it to every conversion request.

V1 deliberately excludes:

- accounts, passwords, OAuth, JWTs, or login sessions;
- a database or API-key table;
- multiple keys, names, scopes, or per-client quotas;
- usage billing or analytics;
- an API-key administration screen;
- key creation, issuance, listing, revocation, or recovery endpoints;
- durable queues, background jobs, callbacks, or polling;
- cross-origin browser clients and permissive CORS;
- distributed rate limiting across multiple replicas.

One valid key grants access to all three protected operations and every preset or document option. This is authentication with a single all-or-nothing authorization policy, not a user-management system. API-key issuance is explicitly deferred until there is a real need for multiple independently managed clients.

## 3. Why Bearer authentication

Use the standard header form:

```http
Authorization: Bearer <OHMYIMG_API_KEY>
```

Do not accept the key in the query string, filename, multipart fields, or JSON options. URLs are commonly retained in browser history, access logs, proxy logs, and monitoring systems. A dedicated custom header such as `X-API-Key` would work, but it offers no benefit here over the standard Bearer form.

Alternative designs were rejected for V1:

| Alternative | Reason not selected |
|---|---|
| Basic authentication | adds no useful identity model for a single random machine credential |
| JWT | introduces signing, claims, expiry, and validation rules without a token issuer or multiple principals |
| OAuth/OIDC | appropriate for user or delegated identity, not one private owner key |
| HMAC-signed requests | supports replay resistance and request integrity, but requires canonicalization, timestamps, and client libraries that are unnecessary over HTTPS for this tool |
| Same-origin bypass | `Origin` and `Referer` are browser signals, not caller authentication; non-browser clients can omit or forge them |
| Server Action for the UI | a remotely invokable server entry point still requires authorization and would only hide a second conversion route |

Bearer credentials are possession credentials. Anyone who obtains the key receives the same conversion access as the owner, so transport and storage protection are part of the design rather than optional hardening.

## 4. Configuration and key lifecycle

### 4.1 Environment variable

Use one server-only runtime variable:

```text
OHMYIMG_API_KEY
```

Never name it with the `NEXT_PUBLIC_` prefix, expose it through `next.config.ts`, serialize it into a Server or Client Component prop, or return it from an endpoint. Import the authentication module only from Node server code and mark it `server-only` if that module could otherwise be imported by UI code.

For local development, put exactly one value in the ignored root `.env` file:

```dotenv
OHMYIMG_API_KEY=replace-with-a-generated-key
```

Do not introduce `OHMYIMG_API_KEYS`, comma-separated values, indexed variables, or a fallback key. For Docker, the one key must be supplied at container runtime rather than baked into the Dockerfile or image layer:

```sh
docker run --rm \
  -p 3000:3000 \
  -e OHMYIMG_API_KEY='replace-with-a-generated-key' \
  oh-my-img
```

For routine use, prefer a local `--env-file` whose permissions are restricted. The repository already ignores `.env*`; if an `.env.example` is later added, add the required `.gitignore` exception and commit only a placeholder, never the active value.

### 4.2 Key requirements

Generate at least 32 random bytes and encode them as base64url. For example:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The initial parser should accept one 32-to-256-character Bearer token made from the RFC Bearer-token character set. It must reject whitespace, control characters, multiple credentials, and oversized values. The configured and presented values are exact; do not call `trim()` on either key.

Configuration behavior must fail closed:

- one valid value: the application can authenticate conversion requests;
- variable absent, empty, too short, too long, or malformed: every conversion route returns generic `503 Service Unavailable` without reading the body;
- the public health route returns generic 503 while configuration is invalid;
- configuration errors are logged without echoing the value;
- a missing or invalid key must never enable an unauthenticated fallback.

Read the key at runtime inside server-only code. Do not require it during `next build`, because the same Docker image should be buildable without embedding its deployment secret. A production container becomes healthy only after a valid runtime key is present.

### 4.3 Comparison

Do not compare the raw strings with `===`. Hash both UTF-8 values with SHA-256, then compare the two fixed-length digests with `node:crypto.timingSafeEqual()`. Digesting first guarantees equal-length inputs to `timingSafeEqual()` even when the supplied token length differs.

This does not turn a weak human password into a strong secret; that is why the configured key must be randomly generated. It does provide a small, auditable comparison path for a high-entropy API key.

### 4.4 Rotation and revocation

V1 rotation is intentionally operational:

1. generate a new key;
2. replace the runtime secret;
3. restart the single container;
4. update external clients;
5. discard the old key.

There is no grace period with two simultaneous keys in V1. Rotation briefly invalidates existing clients until they receive the replacement. Add a previous-key window or issuance system only as a later explicitly designed feature. If a key is exposed, rotate it immediately and inspect authentication-failure and conversion logs around the suspected period.

### 4.5 Deferred key issuance

The current key is created manually by the owner and copied into `.env` or the container secret configuration. The application does not generate or display it.

Do not add any of the following in the current phase:

```text
POST   /api/keys
GET    /api/keys
DELETE /api/keys/:id
```

Revisit issuance only when separate clients need independent revocation, attribution, expiry, or scopes. That later design will require key identifiers, one-time secret display, hashed-at-rest records, an administration authorization boundary, and persistent storage. None of those concepts should be partially introduced into the one-environment-key implementation.

## 5. Authentication flow

Authentication runs at the start of each conversion Route Handler, before `request.formData()`, file buffering, Markdown parsing, image decoding, VTracer, SVGO, ImageMagick, or WeasyPrint.

```text
request
  -> create request ID
  -> validate server key configuration
  -> parse and verify Authorization header
  -> reject or continue
  -> acquire one conversion permit
  -> enforce request and operation-specific limits
  -> run existing conversion pipeline
  -> release permit in finally
  -> return result
```

Authentication responses:

| Condition | Status | Response |
|---|---:|---|
| missing, malformed, or incorrect credential | 401 | `{"error":"Unauthorized.","requestId":"..."}` |
| missing or invalid mandatory server configuration | 503 | `{"error":"Service unavailable.","requestId":"..."}` |
| no conversion permit available | 429 | `{"error":"Server is busy. Try again later.","requestId":"..."}` |

A 401 response includes:

```http
WWW-Authenticate: Bearer realm="ohmyimg-api"
Cache-Control: no-store
X-Request-Id: <request-id>
```

Missing and incorrect request keys return the same status and body. Do not disclose whether the key was absent, had the right prefix, had the right length, or nearly matched. A missing server configuration is a distinct 503 operational failure, but its response still contains no configuration detail. Validation and conversion errors retain their existing concise messages. Unexpected pipeline failures remain `Image processing failed.`, `Conversion failed.`, or `Document conversion failed.` with a request ID; raw tool output and stack traces stay in server logs.

The successful authentication result is not a session. Every later raster, vector, or document request must send the header again and is verified again.

Per-request invariants:

- a handler never remembers that the same browser or IP was previously accepted;
- there is no authentication cookie or server-side session map;
- a valid key on one operation does not implicitly authorize a later request to any other operation;
- an authenticated request cannot delegate access to another request;
- authentication runs before the concurrency permit and before body parsing;
- response caching is disabled, and the credential never appears in response metadata.

## 6. API contract

All three operations use `multipart/form-data`. Image operations carry a bounded binary image, while the document operation carries exactly one bounded Markdown file or string. Do not add base64-in-JSON image or PDF payloads; they increase payload size and memory use without improving the client contract.

### 6.1 Vectorization

```http
POST /api/v1/vectorize
Authorization: Bearer <key>
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `image` | file | yes | static PNG, JPEG, or WebP, subject to the existing byte/dimension/pixel limits |
| `preset` | string | yes | `accurate`, `balanced`, `tiny`, or `auto` |
| `cleanup` | JSON string | no | versioned raster-cleanup settings for manual presets; omitted requests retain legacy behavior and Auto rejects this field until cleaned-reference search is implemented |

Cleanup example:

```json
{"version":1,"cleanup":3,"colors":16,"advanced":{"alphaCutoff":16,"gradientStep":32}}
```

`cleanup` is an integer from 0 through 4. `colors` is `3`, `4`, `6`, `8`, `16`, `32`, `64`, `128`, or `"full"`. Optional Advanced values are strictly allowlisted as described in [Raster Cleanup and Vector Path Cleanup Design](./vector-cleanup-design.md).

The successful response remains JSON so the UI and external clients receive the SVG plus its size, timing, selection, similarity, and complexity metadata in one response. Preserve the current `VectorizeApiResult` shape for API V1 and document any future breaking shape change under `/api/v2`.

Example:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer ${OHMYIMG_API_KEY}" \
  -F image=@cat.png \
  -F preset=balanced \
  -F 'cleanup={"version":1,"cleanup":2,"colors":64}' \
  https://images.example.test/api/v1/vectorize
```

The response includes:

```http
Content-Type: application/json
Cache-Control: no-store
X-Request-Id: <request-id>
```

### 6.2 Raster crop, resize, and optimization

```http
POST /api/v1/optimize-raster
Authorization: Bearer <key>
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `image` | file | yes | static PNG, JPEG, or WebP |
| `options` | JSON string | yes | normalized crop, optional no-upscale resize, `high`, `balanced`, `small`, or `auto` mode, and optional Auto optimization policy |

`options.optimization.policy` accepts `standard` or `smaller`, defaults to `standard`, and is valid only with `mode: "auto"`. The option chooses a bounded server-owned candidate family; it never accepts raw ImageMagick arguments.

Example:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer ${OHMYIMG_API_KEY}" \
  -F image=@photo.jpg \
  -F 'options={"crop":{"x":0.1,"y":0.1,"width":0.8,"height":0.8},"resize":{"maxWidth":1600},"mode":"balanced"}' \
  -D output.headers \
  -o photo-optimized.jpg \
  https://images.example.test/api/v1/optimize-raster
```

The successful body remains the encoded image in its input format. Preserve the existing metadata headers and add `X-Request-Id`:

```text
X-Original-Bytes
X-Output-Bytes
X-Output-Width
X-Output-Height
X-Processing-Ms
X-Selected-Preset
X-Candidate-Count
X-Optimization-Policy
X-SSIM             when available
X-MAE              when available
X-Edge-MAE         when available
X-Alpha-MAE        when available
X-Request-Id
```

Do not wrap the binary output in JSON or base64.

### 6.3 Markdown document to tagged PDF

```http
POST /api/v1/docs-to-pdf
Authorization: Bearer <key>
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `document` | file | exactly one source | UTF-8 `.md`, `.markdown`, or `.txt`, up to 1 MiB |
| `markdown` | string | exactly one source | pasted non-empty UTF-8 Markdown, up to 1 MiB |
| `options` | JSON string | no | `title`, `lang` (`ko` or `en`), `pageSize` (`a4` or `letter`), `orientation`, `template` (`document` or `resume`), and `includePageNumbers` |

`document` and `markdown` are mutually exclusive; sending both or neither is invalid. Omitted options use the fixed document defaults. Raw HTML, custom CSS, scripts, remote resources, DOCX, and arbitrary URLs are not accepted.

Example:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer ${OHMYIMG_API_KEY}" \
  -F document=@resume.md \
  -F 'options={"title":"Resume","lang":"en","pageSize":"a4","orientation":"portrait","template":"resume","includePageNumbers":true}' \
  -D output.headers \
  -o resume.pdf \
  https://images.example.test/api/v1/docs-to-pdf
```

The successful body is the generated tagged PDF/UA-1 file. Its response metadata is:

```text
Content-Type: application/pdf
Content-Disposition
Content-Language
X-Input-Bytes
X-Input-Characters
X-Output-Bytes
X-Output-Pages
X-Processing-Ms
X-Rendering-Ms
X-PDF-Renderer
X-PDF-Variant
X-Request-Id
```

Do not wrap the PDF in JSON or base64. The detailed semantic, pagination, renderer, and resource limits are specified in [Document to PDF Design](./document-to-pdf-design.md).

### 6.4 Common status codes

| Status | Meaning |
|---:|---|
| 200 | conversion completed |
| 400 | malformed multipart data, options, unsupported mode, or unsupported document source |
| 401 | API key required or invalid |
| 413 | encoded upload or declared request too large |
| 415 | unsupported file signature or media type, if separated from the existing 400 behavior |
| 422 | structurally valid image exceeds decoded dimension/pixel constraints, if separated from the existing image-validation behavior |
| 429 | the single-server conversion capacity is busy |
| 500 | conversion failed unexpectedly |
| 503 | the mandatory server key is missing or misconfigured |

Do not change existing 400/413 validation mappings solely to make this table more granular. Stability is more useful than status-code perfection. Every response from the conversion endpoints uses `Cache-Control: no-store`.

## 7. Built-in UI behavior

The server key must never be injected into browser JavaScript. The owner manually enters the same key configured in `.env` or the container runtime. Entering it once in the page is a browser convenience only: the shared client helper still attaches it to every individual conversion request.

Keep the first implementation small:

1. Show one masked API-key field at the workspace boundary, shared by raster, SVG, and document tools.
2. Read and persist the value under the exact `localStorage` key `ohmyimgapikey`; fall back to page memory if browser storage is unavailable.
3. Disable conversion submission while the field is empty.
4. One shared fetch helper adds `Authorization: Bearer <key>` to every raster, vector, and document request.
5. Never send a conversion request without the header, even to a same-origin route.
6. Reuse the in-memory value for the lifetime of the loaded page, but verify it independently on every server request.
7. Reloading or closing the page forgets the key.
8. A 401 focuses the key field and shows `Invalid API key.` without discarding the chosen image, document source, crop rectangle, preset, or document options.
9. The user may edit or clear the key explicitly; there is no automatic key discovery or recovery.

The implemented owner preference stores the key in `localStorage` under `ohmyimgapikey`. This exposes the key to JavaScript executing on the same origin and to anyone using that browser profile, so it is acceptable only for this private single-owner deployment. Do not put it in a URL or non-HttpOnly cookie, and revisit the decision before adding third-party scripts, multiple users, or public hosting. No unlock endpoint, signed-cookie session, or key-issuance subsystem is added.

Centralize browser storage in one hook and header behavior in one fetch helper; do not duplicate either across the raster, SVG, and document components. Neither browser module reads `process.env`.

## 8. Resource admission and abuse boundaries

An API key prevents anonymous use but does not prevent accidental parallel work or abuse after a key leak. These operations are CPU- and memory-intensive: SVG Auto can evaluate six candidates, raster Auto evaluates multiple encodes, and document conversion starts a bounded WeasyPrint process.

Add a process-local, non-queued conversion gate:

- default `OHMYIMG_MAX_CONCURRENT_JOBS=1`;
- accept only a small bounded integer, initially 1 through 4;
- fall back to 1 and log a configuration warning when that variable is missing or invalid;
- acquire before parsing the multipart body so concurrent authenticated uploads cannot all be buffered;
- return 429 immediately when no permit is available;
- include `Retry-After: 1` as a retry hint;
- release the permit in `finally` on success, validation failure, timeout, child exit, or thrown error;
- do not automatically retry work on the server.

One job is the conservative default because VTracer is synchronous, Raster/SVG Auto can already fan out work internally, and PDF rendering runs an external process. Increase the setting only after measuring the Docker container's peak memory and latency.

The gate is per Node process. It is sufficient for the intended single-container deployment. If multiple replicas are introduced, concurrency and rate enforcement must move to the reverse proxy or a shared system; adding Redis or a distributed queue now would be speculative.

Retain the current safeguards:

- encoded upload, image edge, decoded pixel, output byte, child process, stderr, and temporary-disk limits;
- signature validation instead of extension-only validation;
- static PNG/JPEG/WebP only;
- `spawn(binary, args)` with `shell: false` for ImageMagick;
- bounded UTF-8 Markdown, generated HTML, page count, PDF bytes, renderer diagnostics, and render time;
- `spawn(python, args)` with `shell: false` for WeasyPrint, with external resource fetching denied;
- isolated request directories and guaranteed cleanup;
- no permanent image or document storage.

At the public edge, configure HTTPS, a maximum request body, connection/time limits, and optionally a coarse per-IP request rate. Application authentication is still required; reverse-proxy filtering is defense in depth.

## 9. CORS and transport

The initial external API is for server-to-server tools, CLI clients, and trusted automation. These clients do not need CORS, so the application should return no cross-origin access headers.

Do not place the owner API key in a public website, browser extension distributed to others, mobile application bundle, or other untrusted client. Users can extract a static client-side key.

If a real cross-origin browser use case appears later:

- introduce an explicit exact-origin allowlist;
- implement bounded `OPTIONS` handling;
- allow `Authorization` and required content headers only;
- expose only the raster metadata headers that browser JavaScript needs;
- return `Vary: Origin` when the allowed origin is dynamic;
- never treat CORS as authentication.

Bearer credentials must travel over HTTPS outside loopback. TLS should terminate at a trusted reverse proxy or private network ingress, and the upstream hop must also remain inside a trusted boundary.

## 10. Logging and observability

Preserve the project's intentionally simple error model. Do not add an exception hierarchy, stage-level recovery, retries, tracing infrastructure, or persisted job records.

Generate a server-side request ID before authentication. For each completed or failed conversion, log one structured record containing only what is useful for later diagnosis:

- request ID;
- endpoint and final status;
- authenticated outcome, without the credential;
- validated input type or format and byte count;
- selected mode or document template;
- candidate count when available;
- elapsed time;
- bounded internal error or child-process diagnostics on failure.

Authentication failures may be logged with request ID, endpoint, remote address only when it comes from a trusted proxy configuration, and a reason category such as `missing`, `malformed`, or `mismatch`. Never log:

- the `Authorization` header;
- the raw key, a prefix/suffix, or its SHA-256 digest;
- multipart bodies, image bytes, Markdown source, generated HTML, or PDF bytes;
- unbounded stderr, stack traces, or user-controlled header text.

The client receives only the generic response and request ID. Existing logs remain the place to investigate pipeline failures.

## 11. Proposed code boundaries

Keep the change proportional to the project:

```text
src/
|-- app/api/
|   |-- health/route.ts
|   `-- v1/
|       |-- docs-to-pdf/route.ts
|       |-- optimize-raster/route.ts
|       `-- vectorize/route.ts
|-- lib/api/
|   |-- access.ts
|   |-- job-gate.ts
|   `-- multipart.ts
`-- lib/document/
    |-- html.ts
    |-- input.ts
    |-- markdown.ts
    |-- renderer.ts
    `-- types.ts
```

Responsibilities:

- `access.ts`: read and validate server configuration, parse the Bearer header, perform the digest comparison, and create the standard 401/503 response;
- `job-gate.ts`: maintain a bounded process-local active-job count and return an idempotent release function;
- `multipart.ts`: enforce a streaming whole-request cap, parse multipart once, and reject unexpected or repeated operation fields;
- Route Handlers: request ID, access check, permit lifetime, existing multipart validation, core function call, headers, one failure log, and response;
- existing `lib/raster`, `lib/vector`, and `lib/document`: operation-specific validation, transformation, rendering, and result contracts.

Do not create repositories, services, controllers, middleware stacks, custom error hierarchies, or a generic pipeline framework. There are three protected routes and one access rule. A shared Next.js Proxy check may be used as an optional early rejection layer, but it must not replace the authorization call inside each conversion Route Handler.

## 12. Implementation sequence

### Phase 1: access boundary

1. Add `access.ts` and its unit tests.
2. Cover absent, valid, missing, malformed, incorrect, empty-config, short-config, oversized, and exact-match cases.
3. Verify that invalid configuration fails closed.
4. Add request IDs, no-store responses, and `WWW-Authenticate` to auth failures.

### Phase 2: canonical API V1

1. Keep every conversion Route Handler under `/api/v1`, including document rendering.
2. Run the access check before any request-body read.
3. Update the built-in UI to use the versioned paths.
4. Remove the old unversioned image route files rather than preserving aliases.
5. Preserve the current request fields and success payloads.

### Phase 3: UI key handling

1. Add one shared `ohmyimgapikey` local-storage hook at the workspace boundary, with a page-memory fallback.
2. Add one shared authenticated fetch helper.
3. Require a non-empty key before conversion submission.
4. Focus the masked key field after 401 and preserve pending user work.
5. Confirm that no key appears in rendered HTML, client bundles, browser storage, or URLs.

### Phase 4: admission control and deployment docs

1. Add the one-process job gate and `Retry-After` response.
2. Document runtime secret injection and HTTPS deployment.
3. Add Docker smoke requests with no, wrong, and correct credentials.
4. Document external `curl` usage without committing a real key.

### Phase 5: verification

Run unit, route, production-build, Docker, and real-browser checks across all protected workflows. Do not start multi-key management or CORS work unless a concrete client requires it.

## 13. Verification plan

### 13.1 Authentication tests

- all three protected operations reject a missing request header before `formData()` is called;
- malformed scheme, multiple credentials, wrong key, and oversized key all return the same 401 body;
- the exact key succeeds for raster, vector, and document routes;
- an absent, explicitly empty, or malformed configured key returns 503 rather than opening the route;
- the health route needs no request key, returns 200 for valid configuration, and returns generic 503 for invalid configuration;
- one successful call does not authorize a later headerless call;
- no response, log fixture, snapshot, or thrown error contains the configured or presented key.

### 13.2 Admission tests

- one active job holds the only default permit;
- a second request receives 429 without parsing or processing its body or source;
- a permit is released after success, validation failure, child-process failure, timeout, and an unexpected throw;
- an invalid concurrency setting logs a warning and falls back to 1, never to unlimited concurrency.

### 13.3 Contract regression tests

- PNG, JPEG, and WebP work on both image routes with the correct key;
- all manual and Auto modes retain their existing behavior;
- raster output bytes, MIME type, filename, and metadata headers remain correct;
- vector JSON retains its SVG, timing, selection, similarity, and complexity fields;
- Markdown string and supported UTF-8 file inputs return tagged PDF/UA-1 bytes with the documented metadata headers;
- document headings, paragraphs, list items, and normal table rows follow the documented pagination and copy-order contract;
- 10 MiB and decoded-pixel boundaries remain enforced;
- all API responses use `Cache-Control: no-store` and include `X-Request-Id`;
- no old unversioned conversion route remains reachable after migration.

### 13.4 Docker smoke tests

Start the production container with a generated test key and verify:

1. `/api/health` returns 200 without authentication;
2. each conversion route returns 401 without a key;
3. each route returns 401 with an incorrect key;
4. raster, vector, and document sample requests return 200 with the correct key;
5. temporary directories are cleaned after success and failure;
6. container logs contain request IDs but no credential material.

Start a second container without the variable and verify health and conversion routes fail closed with 503 while the server remains diagnosable through generic responses and logs.

### 13.5 Browser checks

- the key field is visible and masked before the first conversion;
- once valid source content is present, the conversion button remains actionable while the key is empty; clicking it shows a concise prompt and focuses the masked key field without sending a request;
- the valid locally stored key is attached to every request in all three workflows;
- an invalid key shows only a concise authentication error;
- reload forgets the key;
- the key is absent from URLs, HTML, local storage, session storage, console output, and downloaded filenames;
- Markdown paste/file submission, generated PDF preview, and downloaded PDF bytes behave consistently;
- the earlier deferred crop interaction checks remain a separate regression checklist.

## 14. Acceptance criteria

The API-key feature is complete when:

- one valid environment key protects every conversion entry point;
- each individual conversion request carries and independently verifies the Bearer header;
- no prior successful request, cookie, IP address, `Origin`, or `Referer` can substitute for that header;
- missing and wrong keys cannot cause request-body parsing or conversion work;
- missing or malformed mandatory configuration fails closed;
- the built-in UI can send the owner-entered key on every request without receiving the server secret;
- external CLI/server clients can call raster, vector, and document operations with documented multipart requests;
- versioned routes are canonical and no unprotected alias exists;
- only one expensive job runs by default and excess work receives 429;
- HTTPS deployment and secret rotation are documented;
- client errors stay generic and server logs remain useful and bounded;
- unit, route, production, Docker, and browser verification pass.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| old route remains open | complete authentication bypass | migrate UI, delete old routes, test them as unreachable |
| key exposed in browser bundle | permanent credential compromise | server-only environment variable; owner enters key at runtime |
| key sent over HTTP | credential theft | require HTTPS outside loopback |
| key appears in logs or URL | long-lived secondary copies | Authorization header only; explicit log exclusions |
| missing or malformed deployment key | conversion unavailable or accidentally open | make the key mandatory; health and conversion routes fail closed with 503 |
| leaked key drives parallel conversions | CPU/memory exhaustion | one-process admission gate, existing resource limits, optional edge rate limit |
| in-memory limit used with replicas | aggregate limit exceeds expectation | document single-container scope; enforce at ingress if scaling |
| UI auth treatment hides another public route | bypass or duplicated logic | authorize inside every canonical Route Handler |
| CORS mistaken for access control | non-browser callers bypass it | no CORS in V1; Bearer verification is authoritative |
| elaborate auth framework increases maintenance | more failure modes than value | one key, two helpers, no DB/session/JWT system |

## 16. References

- [RFC 6750: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [Node.js `crypto.timingSafeEqual()`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js environment variable guide](https://nextjs.org/docs/app/guides/environment-variables)
- [Next.js data security guide](https://nextjs.org/docs/app/guides/data-security)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [MDN CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

## 17. Implementation record

Implemented on 2026-08-24 with the documented minimal boundaries:

- one mandatory `OHMYIMG_API_KEY` from runtime configuration;
- SHA-256 digest comparison through `timingSafeEqual()`;
- authentication before multipart parsing and conversion admission;
- `/api/v1/vectorize`, `/api/v1/optimize-raster`, and `/api/v1/docs-to-pdf` as the only protected conversion paths;
- public readiness at `/api/health`, with generic 503 for invalid key configuration;
- one process-local conversion permit by default and immediate 429 overflow;
- one shared browser storage hook and fetch helper that add the locally stored key to every call;
- no cookie, session, database, multiple-key parser, issuance route, CORS, or retry system;
- `.env*` excluded from both Git and Docker build context.

Verification completed:

- ESLint passed;
- all three routes bound the complete multipart body before parsing it and reject unexpected or repeated operation fields;
- ImageMagick and WeasyPrint child processes receive explicit environment allowlists and never inherit the owner API key;
- 115 Vitest tests pass in the current suite, including ImageMagick child/delegate cancellation and Auto deadline propagation; the Node 24 Alpine Docker builder runs that suite before the production build;
- the Next.js production build exposes `/api/health` and the three versioned conversion routes;
- production HTTP smoke tests cover missing request keys and authenticated conversions; the document smoke produces tagged PDF output through the final non-root Docker runtime;
- Docker runtime smoke tests returned 200 for authenticated conversions and 503 from health/conversion routes when the runtime key was absent;
- the runtime image contained no `/app/.env` file.

The automated browser runner available in this environment failed to load its Playwright module, so the masked-key field still needs a short real-browser interaction pass. The client fetch helper, empty-key guard, 401 focus callback, production rendering build, and all three authenticated pipelines are covered independently below the browser layer.
