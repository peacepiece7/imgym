FROM node:24-alpine3.24 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache \
    font-noto-cjk \
    imagemagick imagemagick-jpeg imagemagick-webp \
    poppler-utils \
    rsvg-convert \
    weasyprint=68.1-r1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm test && pnpm build

FROM node:24-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN apk add --no-cache \
    font-noto-cjk \
    imagemagick imagemagick-jpeg imagemagick-webp \
    rsvg-convert \
    weasyprint=68.1-r1 \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/render-document-pdf.py ./scripts/render-document-pdf.py

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
