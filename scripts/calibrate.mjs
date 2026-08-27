#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_INPUTS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

const RASTER_MODES = {
  auto: ["auto"],
  all: ["auto", "high", "balanced", "small"],
};

const VECTOR_MODES = {
  auto: ["auto"],
  all: ["auto", "accurate", "balanced", "tiny"],
};

const RASTER_POLICIES = {
  standard: ["standard"],
  smaller: ["smaller"],
  both: ["standard", "smaller"],
};

const DEFAULT_OPTIONS = {
  baseUrl: "http://127.0.0.1:3000",
  input: "calibration/corpus",
  output: "calibration/output",
  pipeline: "both",
  modeSet: "auto",
  rasterPolicy: "standard",
  limit: 100,
  timeoutMs: 120_000,
};

function usage() {
  return `Usage: pnpm calibrate -- [options]

Options:
  --base-url <url>       Running OhMyImg server (default: ${DEFAULT_OPTIONS.baseUrl})
  --input <directory>    Corpus directory (default: ${DEFAULT_OPTIONS.input})
  --output <directory>   Parent directory for timestamped runs (default: ${DEFAULT_OPTIONS.output})
  --pipeline <value>     both, raster, or vector (default: both)
  --mode-set <value>     auto or all presets (default: auto)
  --raster-policy <value> standard, smaller, or both (default: standard)
  --limit <number>       Maximum files, 1-500 (default: ${DEFAULT_OPTIONS.limit})
  --timeout-ms <number>  Per-request timeout, 1000-300000 (default: ${DEFAULT_OPTIONS.timeoutMs})
  --help                 Show this help
`;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function boundedInteger(value, flag, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") {
      continue;
    } else if (flag === "--help") {
      options.help = true;
    } else if (flag === "--base-url") {
      options.baseUrl = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--input") {
      options.input = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--output") {
      options.output = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--pipeline") {
      options.pipeline = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--mode-set") {
      options.modeSet = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--raster-policy") {
      options.rasterPolicy = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--limit") {
      options.limit = boundedInteger(readValue(argv, index, flag), flag, 1, 500);
      index += 1;
    } else if (flag === "--timeout-ms") {
      options.timeoutMs = boundedInteger(readValue(argv, index, flag), flag, 1_000, 300_000);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!["both", "raster", "vector"].includes(options.pipeline)) {
    throw new Error("--pipeline must be both, raster, or vector");
  }
  if (!["auto", "all"].includes(options.modeSet)) {
    throw new Error("--mode-set must be auto or all");
  }
  if (!Object.hasOwn(RASTER_POLICIES, options.rasterPolicy)) {
    throw new Error("--raster-policy must be standard, smaller, or both");
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  try {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new Error("--base-url must be an HTTP or HTTPS URL without credentials, query, or fragment");
  }
  return options;
}

async function walk(directory, root, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, root, files);
    if (entry.isFile() && SUPPORTED_INPUTS.has(extname(entry.name).toLowerCase())) {
      files.push({ path, relativePath: relative(root, path) });
    }
  }
}

export async function discoverInputs(inputDirectory, limit) {
  const root = resolve(inputDirectory);
  const files = [];
  await walk(root, root, files);
  return files.slice(0, limit);
}

export function safeId(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "image";
}

function runId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function categoryFor(relativePath) {
  const parts = relativePath.split(sep);
  return parts.length > 1 ? parts[0] : "uncategorized";
}

function requestSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function responseError(response) {
  let message = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // The API contract uses JSON errors, but retain the status if an intermediary does not.
  }
  return { httpStatus: response.status, error: message, requestId: response.headers.get("x-request-id") };
}

function fatalStatus(status) {
  return status === 401 || status === 429 || status === 503;
}

function numberHeader(headers, name) {
  const value = headers.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function authenticatedHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function runRaster({ baseUrl, apiKey, timeoutMs, input, mode, policy, outputDirectory, assetId }) {
  const body = new FormData();
  body.append("image", new Blob([input.bytes], { type: input.mime }), basename(input.path));
  body.append("options", JSON.stringify({
    crop: { x: 0, y: 0, width: 1, height: 1 },
    resize: {},
    mode,
    ...(mode === "auto" ? { optimization: { policy } } : {}),
  }));

  const response = await fetch(`${baseUrl}/api/v1/optimize-raster`, {
    method: "POST",
    headers: authenticatedHeaders(apiKey),
    body,
    signal: requestSignal(timeoutMs),
  });
  if (!response.ok) {
    const failure = await responseError(response);
    if (fatalStatus(failure.httpStatus)) throw new Error(`Raster API unavailable: ${failure.error}`);
    return { mode, policy, status: "error", ...failure };
  }

  const output = Buffer.from(await response.arrayBuffer());
  const extension = extname(input.path).toLowerCase() === ".jpeg" ? ".jpg" : extname(input.path).toLowerCase();
  const variant = mode === "auto" ? `${mode}-${policy}` : mode;
  const outputFile = `assets/${assetId}-raster-${variant}${extension}`;
  await writeFile(join(outputDirectory, outputFile), output);
  return {
    mode,
    policy,
    status: "ok",
    outputFile,
    bytes: output.byteLength,
    width: numberHeader(response.headers, "x-output-width"),
    height: numberHeader(response.headers, "x-output-height"),
    durationMs: numberHeader(response.headers, "x-processing-ms"),
    selection: {
      candidate: response.headers.get("x-selected-preset"),
      candidates: numberHeader(response.headers, "x-candidate-count"),
      policy: response.headers.get("x-optimization-policy") ?? policy,
      qualityGate: response.headers.get("x-quality-gate") ?? undefined,
      minimumSsim: numberHeader(response.headers, "x-quality-min-ssim"),
      maximumMae: numberHeader(response.headers, "x-quality-max-mae"),
      ssim: numberHeader(response.headers, "x-ssim"),
      mae: numberHeader(response.headers, "x-mae"),
      edgeMae: numberHeader(response.headers, "x-edge-mae"),
      alphaMae: numberHeader(response.headers, "x-alpha-mae"),
    },
  };
}

async function runVector({ baseUrl, apiKey, timeoutMs, input, mode, outputDirectory, assetId }) {
  const body = new FormData();
  body.append("image", new Blob([input.bytes], { type: input.mime }), basename(input.path));
  body.append("preset", mode);

  const response = await fetch(`${baseUrl}/api/v1/vectorize`, {
    method: "POST",
    headers: authenticatedHeaders(apiKey),
    body,
    signal: requestSignal(timeoutMs),
  });
  if (!response.ok) {
    const failure = await responseError(response);
    if (fatalStatus(failure.httpStatus)) throw new Error(`Vector API unavailable: ${failure.error}`);
    return { mode, status: "error", ...failure };
  }

  const payload = await response.json();
  const outputFile = `assets/${assetId}-vector-${mode}.svg`;
  await writeFile(join(outputDirectory, outputFile), payload.svg, "utf8");
  return {
    mode,
    status: "ok",
    outputFile,
    bytes: payload.output.optimizedBytes,
    rawBytes: payload.output.rawBytes,
    width: payload.input.width,
    height: payload.input.height,
    timing: payload.timing,
    selection: payload.selection,
    stats: payload.stats,
  };
}

function countResults(images, pipeline) {
  const results = images.flatMap((image) => image[pipeline] ?? []);
  return {
    attempted: results.length,
    succeeded: results.filter((result) => result.status === "ok").length,
    failed: results.filter((result) => result.status === "error").length,
  };
}

export function summarize(images) {
  return {
    images: images.length,
    raster: countResults(images, "raster"),
    vector: countResults(images, "vector"),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatMetric(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function resultCard(pipeline, result) {
  const variant = result.policy && result.mode === "auto" ? `${result.mode}/${result.policy}` : result.mode;
  if (result.status === "error") {
    return `<article class="card failed"><div class="preview"><span>Failed</span></div><h3>${escapeHtml(pipeline)} · ${escapeHtml(variant)}</h3><p>${escapeHtml(result.error)}</p></article>`;
  }
  const selection = result.selection ?? {};
  const complexity = result.stats
    ? `<span>Paths ${result.stats.paths}</span><span>Commands ${result.stats.commands}</span><span>Colors ${result.stats.colors}</span>`
    : "";
  const quality = `<span>SSIM ${formatMetric(selection.ssim)}</span><span>MAE ${formatMetric(selection.mae)}</span>${selection.edgeMae === undefined ? "" : `<span>Edge MAE ${formatMetric(selection.edgeMae)}</span>`}${selection.alphaMae === undefined ? "" : `<span>Alpha MAE ${formatMetric(selection.alphaMae)}</span>`}`;
  return `<article class="card">
    <a class="preview" href="${escapeHtml(result.outputFile)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(result.outputFile)}" loading="lazy" alt="${escapeHtml(`${pipeline} ${result.mode}`)} result"></a>
    <h3>${escapeHtml(pipeline)} · ${escapeHtml(variant)}</h3>
    <p>${escapeHtml(selection.candidate ?? result.mode)} · ${formatBytes(result.bytes)}</p>
    <div class="metrics">${quality}${complexity}</div>
  </article>`;
}

export function renderContactSheet(report) {
  const sections = report.images.map((image) => {
    const cards = [
      `<article class="card original"><a class="preview" href="${escapeHtml(image.original.outputFile)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(image.original.outputFile)}" loading="lazy" alt="Original image"></a><h3>Original</h3><p>${formatBytes(image.original.bytes)}</p></article>`,
      ...image.raster.map((result) => resultCard("Raster", result)),
      ...image.vector.map((result) => resultCard("Vector", result)),
    ].join("\n");
    return `<section class="image-set"><header><div><span class="category">${escapeHtml(image.category)}</span><h2>${escapeHtml(image.source)}</h2></div><a href="#top">Top</a></header><div class="grid">${cards}</div></section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OhMyImg calibration ${escapeHtml(report.runId)}</title>
  <style>
    :root{color-scheme:dark;background:#101311;color:#eef2ec;font-family:ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:1600px;margin:auto;padding:40px 24px 80px}a{color:#a9d7ad}.lede{color:#aeb8af;max-width:75ch}.summary{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 48px}.pill,.category{border:1px solid #3a443c;border-radius:999px;padding:6px 10px;color:#c9d2ca;font-size:13px}.image-set{border-top:1px solid #303732;padding:32px 0 44px}.image-set>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.image-set h2{font-size:20px;margin:10px 0 0;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.card{background:#171b18;border:1px solid #303732;border-radius:14px;overflow:hidden}.card.failed{border-color:#69433f}.preview{height:250px;background-color:#f1f2ee;background-image:linear-gradient(45deg,#d7d9d3 25%,transparent 25%),linear-gradient(-45deg,#d7d9d3 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d7d9d3 75%),linear-gradient(-45deg,transparent 75%,#d7d9d3 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;display:grid;place-items:center}.preview img{display:block;width:100%;height:100%;object-fit:contain}.card h3,.card p,.metrics{margin:14px 16px}.card h3{font-size:15px}.card p{color:#b7c0b8;font-size:14px}.metrics{display:flex;flex-wrap:wrap;gap:8px;color:#8f9d91;font:12px ui-monospace,SFMono-Regular,monospace}.metrics span{border:1px solid #303732;padding:4px 6px;border-radius:6px}@media(max-width:600px){main{padding:24px 14px 60px}.preview{height:220px}}
  </style>
</head>
<body><main id="top">
  <h1>OhMyImg calibration</h1>
  <p class="lede">Visual review companion for <a href="report.json">report.json</a>. Transparent backgrounds use a checkerboard. Metrics are supporting evidence, not a substitute for checking important edges, text, faces, gradients, and transparency.</p>
  <div class="summary"><span class="pill">${report.summary.images} images</span><span class="pill">Raster ${report.summary.raster.succeeded}/${report.summary.raster.attempted}</span><span class="pill">Vector ${report.summary.vector.succeeded}/${report.summary.vector.attempted}</span><span class="pill">Mode set: ${escapeHtml(report.configuration.modeSet)}</span></div>
  ${sections}
</main></body></html>`;
}

async function checkServer(baseUrl, timeoutMs) {
  const response = await fetch(`${baseUrl}/api/health`, { signal: requestSignal(timeoutMs) });
  if (!response.ok) throw new Error(`OhMyImg is not ready at ${baseUrl} (HTTP ${response.status})`);
}

function validatePaths(inputDirectory, outputDirectory) {
  const input = resolve(inputDirectory);
  const output = resolve(outputDirectory);
  if (output === input || output.startsWith(`${input}${sep}`)) {
    throw new Error("--output must not be inside --input");
  }
  return { input, output };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const apiKey = process.env.OHMYIMG_API_KEY;
  if (!apiKey || apiKey.length < 32) throw new Error("OHMYIMG_API_KEY is missing or invalid");
  const paths = validatePaths(options.input, options.output);
  const inputs = await discoverInputs(paths.input, options.limit);
  if (inputs.length === 0) throw new Error(`No PNG, JPEG, or WebP files found in ${options.input}`);
  await checkServer(options.baseUrl, options.timeoutMs);

  const id = runId();
  const outputDirectory = join(paths.output, `run-${id}`);
  await mkdir(paths.output, { recursive: true });
  await mkdir(outputDirectory);
  await mkdir(join(outputDirectory, "assets"));
  const images = [];
  const rasterModes = options.pipeline === "vector" ? [] : RASTER_MODES[options.modeSet];
  const vectorModes = options.pipeline === "raster" ? [] : VECTOR_MODES[options.modeSet];

  for (const [index, file] of inputs.entries()) {
    process.stdout.write(`[${index + 1}/${inputs.length}] ${file.relativePath}\n`);
    const extension = extname(file.path).toLowerCase();
    const assetId = `${String(index + 1).padStart(3, "0")}-${safeId(file.relativePath.slice(0, -extension.length))}`;
    const originalFile = `assets/${assetId}-original${extension}`;
    await copyFile(file.path, join(outputDirectory, originalFile));
    const bytes = await readFile(file.path);
    const input = { ...file, bytes, mime: SUPPORTED_INPUTS.get(extension) };
    const raster = [];
    const vector = [];
    for (const mode of rasterModes) {
      const policies = mode === "auto" ? RASTER_POLICIES[options.rasterPolicy] : ["standard"];
      for (const policy of policies) {
        raster.push(await runRaster({ ...options, apiKey, input, mode, policy, outputDirectory, assetId }));
      }
    }
    for (const mode of vectorModes) {
      vector.push(await runVector({ ...options, apiKey, input, mode, outputDirectory, assetId }));
    }
    images.push({
      id: assetId,
      category: categoryFor(file.relativePath),
      source: file.relativePath,
      original: { outputFile: originalFile, bytes: bytes.byteLength, mime: input.mime },
      raster,
      vector,
    });
  }

  const report = {
    schemaVersion: 1,
    runId: id,
    generatedAt: new Date().toISOString(),
    configuration: {
      baseUrl: options.baseUrl,
      pipeline: options.pipeline,
      modeSet: options.modeSet,
      rasterPolicy: options.rasterPolicy,
      limit: options.limit,
      timeoutMs: options.timeoutMs,
    },
    summary: summarize(images),
    images,
  };
  await writeFile(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(outputDirectory, "contact-sheet.html"), renderContactSheet(report), "utf8");
  process.stdout.write(`Report: ${join(outputDirectory, "report.json")}\n`);
  process.stdout.write(`Contact sheet: ${join(outputDirectory, "contact-sheet.html")}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`Calibration failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
