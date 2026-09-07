# Operations

## Production facts

| Item | Value |
| --- | --- |
| Public URL | <https://dev.margins.cloud/imgym> |
| Health URL | <https://dev.margins.cloud/imgym/api/health> |
| Public proxy | Nginx on `dev.margins.cloud` |
| Private upstream | `127.0.0.1:5820` |
| Container port | `3000` |
| Base path | `/imgym` |
| Service name | Compose project `imgym`, service `app` |
| Required secret | `OHMYIMG_API_KEY` |
| Durable application data | None |

The repository contains no Vercel project link and the documented production is a manually updated Docker Compose deployment behind Nginx.

## Local development

Use Node.js 24 and pnpm 10.7.1. Create an ignored `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

```dotenv
OHMYIMG_API_KEY=replace-with-generated-value
```

Then run:

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3000/imgym>. A host installation needs the native tools listed in [Project Shape](./project-shape.md). Prefer Docker when verifying complete codec behavior.

## Deploy an update

The production checkout is `/opt/imgym`. Pull `main` and recreate the container:

```sh
cd /opt/imgym
git pull --ff-only
docker compose up -d --build
```

Detailed one-time host/Nginx setup is in [Manual Deployment](../manual-deployment.md).

## API-key rotation

1. Generate a new random value of at least 32 characters.
2. Replace `OHMYIMG_API_KEY` in `/opt/imgym/.env` and keep the file mode at `600`.
3. Recreate the service with `docker compose up -d`.
4. Replace the key in the owner browser UI; the old browser value is in `localStorage.ohmyimgapikey`.

Never put the key in a URL, committed file, shell history argument, log statement, or screenshot.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `OHMYIMG_API_KEY` | yes | Single owner Bearer credential, 32–256 allowed characters. |
| `OHMYIMG_MAX_CONCURRENT_JOBS` | no | Integer 1–4; defaults to 1 per Node process. |
| `IMAGEMAGICK_BINARY` | no | Trusted ImageMagick executable override. |
| `FFMPEG_BINARY` | no | Trusted FFmpeg executable override. |
| `PYFTSUBSET_BINARY` | no | Trusted FontTools subset executable override. |
| `DOCUMENT_PDF_PYTHON_BINARY` | no | Absolute managed Python interpreter for PDF rendering. |
| `DOCUMENT_PDF_RENDER_SCRIPT` | no | Trusted PDF renderer script override. |

Asset-audit policy variables begin with `ASSET_` and affect only `scripts/audit-assets.mjs`; see the script for defaults.

## Failure guide

| Symptom | First checks |
| --- | --- |
| Health 503 | `OHMYIMG_API_KEY` exists, length/pattern is valid, Compose loaded `.env`. |
| Conversion 401 | Browser/client key matches current server key and `Authorization` reaches Nginx. |
| Conversion 429 | Another job is active; retry after one second or carefully raise the single-process limit. |
| Upload 413 | Nginx 12 MiB limit and workflow-specific per-file/total limits; recipes allow 20 MiB but current Nginx may be the tighter public boundary. |
| Conversion timeout | Nginx 100-second timeouts, application search budget, native process availability, container CPU/memory. |
| SVG Auto fails only in runtime | Confirm `rsvg-convert` and VTracer WASM are present in the final image. |
| GIF/font recipe fails on host | Verify FFmpeg encoders or FontTools/Brotli; reproduce in the canonical Docker image. |
| PDF has missing Korean glyphs | Verify Noto CJK and WeasyPrint 68.1 inside the container. |
| Streamed download stops | Check client cancellation, Nginx buffering, container logs, and permit release/temporary cleanup. |

## Logs and evidence

Application failures log the request ID and bounded internal context. Client responses intentionally hide native stderr. Correlate through `X-Request-Id` without logging the Authorization header or source contents. Calibration outputs belong in ignored `calibration/output/`; private corpus files must not be committed.
