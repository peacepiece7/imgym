# Manual deployment at `dev.margins.cloud/imgym`

## Deployment contract

OhMyImg is built with the immutable Next.js `basePath` `/imgym` and is served at:

```text
https://dev.margins.cloud/imgym
```

The host Node.js version is irrelevant. The multi-stage Docker build pins Node.js 24 Alpine and installs ImageMagick, librsvg, WeasyPrint, and the required fonts inside the image. Nginx is the only public entry point; Compose binds the application only to `127.0.0.1:5820`.

Do not strip `/imgym` in Nginx. Next.js must receive the preserved path so its pages, Route Handlers, and `/_next` assets stay in the same isolated path namespace.

## One-time host preparation

Create the application directory as the SSH user:

```sh
sudo install -d -o peacepiece -g peacepiece /opt/imgym
git clone https://github.com/peacepiece7/imgym.git /opt/imgym
```

Create `/opt/imgym/.env` without committing it:

```dotenv
OHMYIMG_API_KEY=replace-with-a-new-random-value
```

Generate a value on any trusted machine and restrict the file:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
chmod 600 /opt/imgym/.env
```

Node.js is not required on the production host for building or running OhMyImg.

Copy `deploy/nginx-imgym.locations.conf` to `/etc/nginx/snippets/imgym.conf`, then add this line inside the existing `dev.margins.cloud` HTTPS `server` block:

```nginx
include /etc/nginx/snippets/imgym.conf;
```

The Nginx request limit is deliberately `12m`: an encoded image may be 10 MiB, and the multipart envelope adds bytes around it. The 10-second value is a connection timeout, not a conversion deadline. Response and send timeouts are 100 seconds because bounded Auto searches may run for up to 90 seconds.

Validate and reload Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

No DNS, Certbot, firewall, host Node.js, host ImageMagick, or public application port change is required.

## First start

```sh
cd /opt/imgym
docker compose build
docker compose up -d
docker compose ps
```

Verify the private upstream before testing Nginx:

```sh
curl --fail http://127.0.0.1:5820/imgym/api/health
curl --fail https://dev.margins.cloud/imgym/api/health
```

Then open `https://dev.margins.cloud/imgym` and enter the same API key in the UI. The browser stores it under `localStorage.ohmyimgapikey` on the shared `dev.margins.cloud` origin. Next.js treats the no-trailing-slash URL as canonical; both the exact `/imgym` location and its `/imgym/` descendants must be proxied rather than redirected by Nginx.

## Manual update and rollback

Record the current revision, fast-forward, rebuild, and replace the container:

```sh
cd /opt/imgym
git rev-parse HEAD
git fetch origin
git checkout main
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
```

For rollback, check out the recorded commit and run the last three Docker commands again. Compose keeps the host port private and recreates only the OhMyImg container; it does not modify the Margins containers or services.

## Access control

Bearer authentication remains mandatory for every conversion request. The UI and health endpoint remain visible until access control is added to the entire `dev.margins.cloud` server. Because path-based applications share one browser origin, JavaScript served elsewhere on `dev.margins.cloud` can access the same local storage. This is acceptable only while both applications and the browser profile remain owner-controlled.
