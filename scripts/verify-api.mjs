import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run against an actual HTTPS server. No imports from application code: this
// checks the published contract and downloaded results as an external client.
const base = (process.env.API_BASE_URL ?? "https://dev.margins.cloud/imgym").replace(/\/$/, "");
const key = process.env.OHMYIMG_API_KEY;
assert(key, "Set OHMYIMG_API_KEY in the caller's environment.");
const output = process.env.API_VERIFY_OUTPUT ?? await mkdtemp(join(tmpdir(), "imgym-api-results-"));
const fixtures = process.env.API_VERIFY_FIXTURES ?? await mkdtemp(join(tmpdir(), "imgym-api-fixtures-"));
const paths = ["inspect-assets", "web-assets", "web-assets/preview", "asset-recipes", "asset-recipes/preview", "media-recipes", "optimize-raster", "vectorize", "optimize-svg", "docs-to-pdf"].map((path) => `/api/v1/${path}`);
const results = [];
await mkdir(output, { recursive: true });

function run(binary, args) {
  return execFileSync(binary, args, { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

async function prepareFixtures() {
  const magick = process.env.MAGICK_BINARY ?? "magick";
  run(magick, ["-size", "128x128", "xc:white", "-fill", "#ea580c", "-draw", "rectangle 16,16 111,111", "-fill", "#2563eb", "-draw", "circle 64,64 64,40", join(fixtures, "source.png")]);
  for (const extension of ["jpg", "webp", "heic"]) {
    run(magick, [join(fixtures, "source.png"), "-depth", "8", join(fixtures, `source.${extension}`)]);
  }
  run(magick, ["-delay", "10", "-loop", "0", join(fixtures, "source.png"), "(", "+clone", "-flop", ")", join(fixtures, "motion.gif")]);
  const font = process.env.API_VERIFY_FONT ?? ["/usr/share/fonts/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].find(existsSync);
  assert(font, "Set API_VERIFY_FONT to a font you may subset, or run in the project's Docker runtime.");
  run(process.env.PYFTSUBSET_BINARY ?? "pyftsubset", [font, ...(font.endsWith(".ttc") ? ["--font-number=0"] : []), "--text=ABC 123 안녕하세요 Oh My Img", `--output-file=${join(fixtures, "font.otf")}`]);
  await writeFile(join(fixtures, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#ea580c"/></svg>');
}

// zipfile verifies CRCs; hashes and sizes prove the manifest describes actual
// downloaded files. A 200 ZIP with only failed items must fail verification.
const checkZip = String.raw`
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None, 'ZIP CRC failure'
    manifests = [name for name in archive.namelist() if name.endswith('/manifest.json') or name == 'manifest.json']
    assert len(manifests) == 1, 'Expected one manifest'
    manifest = json.loads(archive.read(manifests[0]))
    assert manifest.get('schemaVersion'), 'Missing manifest version'
    if 'items' in manifest:
        assert manifest['summary']['failed'] == 0, 'Pack contains failed assets'
        assert manifest['summary']['succeeded'] > 0, 'Pack has no successful asset'
        outputs = [output for item in manifest['items'] for output in item['outputs']]
    else:
        outputs = manifest['outputs']
    assert outputs, 'No generated outputs'
    for output in outputs:
        data = archive.read(output['path'])
        assert len(data) == output['bytes'], 'Output byte count differs'
        assert hashlib.sha256(data).hexdigest() == output['sha256'], 'Output SHA256 differs'
        if output['path'].endswith('.woff2'): assert data[:4] == b'wOF2'
        if output['path'].endswith('.webm'): assert data[:4] == bytes.fromhex('1a45dfa3')
        if output['path'].endswith('.mp4'): assert data[4:8] == b'ftyp'
    print(json.dumps({'schemaVersion': manifest['schemaVersion'], 'outputs': len(outputs)}))
`;

async function request(path, init = {}) {
  return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(300_000) });
}

async function file(name) {
  return new File([await readFile(join(fixtures, name))], name);
}

async function conversion(path, label, fields) {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  const started = performance.now();
  const response = await request(path, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}; ${bytes.subarray(0, 300).toString()}`);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert(response.headers.get("x-request-id"), `${label}: missing request ID`);
  const mime = response.headers.get("content-type").split(";")[0];
  const extension = { "application/zip": "zip", "application/pdf": "pdf", "application/json": "json", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime];
  assert(extension, `${label}: unexpected response type ${mime}`);
  const target = join(output, `${String(results.length + 1).padStart(2, "0")}-${label.replace(/[^a-z0-9-]/gi, "-")}.${extension}`);
  await writeFile(target, bytes);
  let details;
  if (mime === "application/zip") {
    details = JSON.parse(run(process.env.PYTHON_BINARY ?? "python3", ["-c", checkZip, target]).toString());
  } else if (mime === "application/json") {
    const json = JSON.parse(bytes);
    if (path.endsWith("inspect-assets")) {
      assert.equal(json.items.length, fields.filter(([name]) => name === "images").length);
      assert(json.items.every((item) => item.status === "ready" && item.facts.width > 0), label);
    } else {
      assert(json.svg?.includes("<svg") && json.downloadName?.endsWith(".svg"), label);
      assert(!/<script\b/i.test(json.svg), label);
      assert(json.input && json.output && json.stats, label);
      if (path.endsWith("vectorize")) assert(json.selection && json.timing, label);
      else assert(json.safety, label);
    }
  } else if (mime === "application/pdf") {
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", label);
    assert(Number(response.headers.get("x-output-pages")) > 0, label);
    assert.equal(response.headers.get("x-pdf-variant"), "PDF/UA-1", label);
  } else {
    const valid = mime === "image/png" ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      : mime === "image/jpeg" ? bytes.subarray(0, 3).toString("hex") === "ffd8ff"
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    assert(valid, `${label}: invalid image signature`);
    assert(Number(response.headers.get("x-output-width")) > 0 && Number(response.headers.get("x-output-height")) > 0, label);
  }
  results.push({ path, label, status: response.status, mime, bytes: bytes.length, ms: Math.round(performance.now() - started), ...details });
  console.log(`PASS ${label}: ${mime}, ${bytes.length} bytes`);
}

try {
  if (!process.env.API_VERIFY_FIXTURES) await prepareFixtures();
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "healthy" });
  const specification = await request("/api/openapi");
  assert.equal(specification.status, 200);
  const api = await specification.json();
  assert.equal(api.openapi, "3.1.0");
  assert.deepEqual(Object.keys(api.paths).filter((path) => api.paths[path].post).sort(), [...paths].sort());
  const docs = await request("/api-docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  for (const path of paths) assert(html.includes(path), `Documentation omits ${path}`);

  for (const path of paths) {
    for (const authorization of [undefined, "Bearer wrong-key-0123456789abcdefghijklmnop"]) {
      const response = await request(path, { method: "POST", headers: authorization ? { Authorization: authorization } : {} });
      assert.equal(response.status, 401, `${path}: authentication bypass`);
      assert(response.headers.get("www-authenticate")?.startsWith("Bearer"));
      assert.equal((await response.json()).error, "Unauthorized.");
    }
    const response = await request(path, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: new FormData() });
    assert.equal(response.status, 400, `${path}: expected empty-body validation`);
    await response.arrayBuffer();
  }

  await conversion("/api/v1/inspect-assets", "inspect-three-formats", await Promise.all(["png", "jpg", "webp"].map(async (ext) => ["images", await file(`source.${ext}`)])));
  await conversion("/api/v1/optimize-svg", "optimize-svg", [["image", await file("icon.svg")], ["precision", "3"]]);
  for (const path of paths.filter((path) => !path.endsWith("inspect-assets") && !path.endsWith("optimize-svg"))) {
    const properties = api.paths[path].post.requestBody.content["multipart/form-data"].schema.properties;
    // Exercise every published recipe on its preview route as well.
    const examples = path === "/api/v1/asset-recipes/preview"
      ? api.paths["/api/v1/asset-recipes"].post.requestBody.content["multipart/form-data"].schema.properties.options.examples
      : (properties.options ?? properties.cleanup)?.examples;
    assert(examples?.length, `${path}: no executable published examples`);
    for (const [index, example] of examples.entries()) {
      const options = JSON.parse(example);
      const fields = [];
      if (properties.markdown) fields.push(["markdown", "# API 확인\n\n한국어 문서와 **강조**를 검사합니다.\n\n- 항목 하나\n- 항목 둘"]);
      else {
        const name = properties.asset ? "asset" : properties.images ? "images" : "image";
        const fixture = options.recipe === "heic" ? "source.heic" : options.recipe === "gif-video" ? "motion.gif" : options.recipe === "font" ? "font.otf" : "source.png";
        fields.push([name, await file(fixture)]);
      }
      fields.push([properties.cleanup ? "cleanup" : "options", example]);
      if (properties.preset) fields.push(["preset", "balanced"]);
      await conversion(path, `${path.slice(8).replaceAll("/", "-")}-${options.recipe ?? index + 1}`, fields);
    }
  }
  for (const preset of ["accurate", "balanced", "tiny", "auto"]) {
    await conversion("/api/v1/vectorize", `vectorize-${preset}`, [["image", await file("source.png")], ["preset", preset]]);
  }
  for (const mode of ["high", "balanced", "small", "auto"]) {
    for (const ext of ["png", "jpg", "webp"]) {
      await conversion("/api/v1/optimize-raster", `raster-${mode}-${ext}`, [["image", await file(`source.${ext}`)], ["options", JSON.stringify({ crop: { x: 0, y: 0, width: 1, height: 1 }, mode, ...(mode === "auto" ? { optimization: { policy: "smaller" } } : {}) })]]);
    }
  }
  assert.deepEqual([...new Set(results.map(({ path }) => path))].sort(), [...paths].sort());
  await writeFile(join(output, "report.json"), JSON.stringify({ base, version: api.info.version, verifiedAt: new Date().toISOString(), authenticationChecks: paths.length * 2, validationChecks: paths.length, results }, null, 2));
  console.log(`Verified ${paths.length} conversion APIs in ${results.length} successful conversions. Results: ${output}`);
} finally {
  if (!process.env.API_VERIFY_FIXTURES) await rm(fixtures, { recursive: true, force: true });
}
