import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DOCUMENT_PDF_LIMITS, type DocumentPdfRenderResult } from "./types";

interface RendererMetadata {
  pages: number;
  renderer: string;
  variant: string;
}

export class DocumentPdfError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "DocumentPdfError";
  }
}

function parseRendererMetadata(stdout: Buffer): RendererMetadata {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stdout.toString("utf8"));
  } catch {
    throw new DocumentPdfError("Document renderer returned invalid metadata");
  }
  if (!candidate || typeof candidate !== "object") {
    throw new DocumentPdfError("Document renderer returned invalid metadata");
  }
  const raw = candidate as Record<string, unknown>;
  if (
    !Number.isInteger(raw.pages)
    || (raw.pages as number) < 1
    || (raw.pages as number) > DOCUMENT_PDF_LIMITS.maxPages
    || typeof raw.renderer !== "string"
    || raw.renderer !== "WeasyPrint 68.1"
    || raw.variant !== "PDF/UA-1"
  ) {
    throw new DocumentPdfError("Document renderer returned invalid metadata");
  }
  return raw as unknown as RendererMetadata;
}

async function runRenderer(
  script: string,
  inputPath: string,
  outputPath: string,
  directory: string,
  signal?: AbortSignal,
) {
  const projectPython = process.platform === "win32"
    ? resolve(process.cwd(), ".venv", "Scripts", "python.exe")
    : resolve(process.cwd(), ".venv", "bin", "python3");
  const binary = process.env.DOCUMENT_PDF_PYTHON_BINARY
    || (existsSync(projectPython) ? projectPython : "python3");
  const cacheDirectory = join(directory, "cache");
  await mkdir(cacheDirectory);
  const rendererEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL,
    DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH,
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    FONTCONFIG_FILE: process.env.FONTCONFIG_FILE,
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    TMPDIR: directory,
    XDG_CACHE_HOME: cacheDirectory,
  };

  return new Promise<{ stdout: Buffer; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ binary, [script, "--input", inputPath, "--output", outputPath], {
      shell: false,
      cwd: directory,
      env: rendererEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: DocumentPdfError | null = null;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (error: DocumentPdfError) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1_000);
    };
    const abort = () => fail(new DocumentPdfError("Document renderer was cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(
      () => fail(new DocumentPdfError("Document renderer timed out")),
      DOCUMENT_PDF_LIMITS.timeoutMs,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > DOCUMENT_PDF_LIMITS.maxStdoutBytes) {
        fail(new DocumentPdfError("Document renderer output exceeded the limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, DOCUMENT_PDF_LIMITS.maxStderrBytes - stderrBytes);
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
      stderrBytes += chunk.byteLength;
      if (stderrBytes > DOCUMENT_PDF_LIMITS.maxStderrBytes) {
        fail(new DocumentPdfError("Document renderer diagnostics exceeded the limit"));
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      reject(new DocumentPdfError("Could not start document renderer", String(error)));
    });
    child.on("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
      if (failure) {
        reject(new DocumentPdfError(failure.message, diagnostics));
      } else if (code !== 0) {
        reject(new DocumentPdfError(`Document renderer exited with ${code ?? exitSignal ?? "an error"}`, diagnostics));
      } else {
        resolvePromise({ stdout: Buffer.concat(stdout), stderr: diagnostics });
      }
    });
  });
}

export async function renderDocumentPdf(
  html: string,
  signal?: AbortSignal,
): Promise<DocumentPdfRenderResult> {
  signal?.throwIfAborted();
  const startedAt = performance.now();
  const directory = await mkdtemp(join(tmpdir(), "ohmyimg-document-"));
  try {
    const inputPath = join(directory, "document.html");
    const outputPath = join(directory, "document.pdf");
    const script = process.env.DOCUMENT_PDF_RENDER_SCRIPT
      || resolve(process.cwd(), "scripts/render-document-pdf.py");
    await writeFile(inputPath, html, { encoding: "utf8", flag: "wx" });

    const execution = await runRenderer(script, inputPath, outputPath, directory, signal);
    const metadata = parseRendererMetadata(execution.stdout);
    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size < 5 || outputStat.size > DOCUMENT_PDF_LIMITS.maxOutputBytes) {
      throw new DocumentPdfError("Document renderer output exceeded the limit", execution.stderr);
    }
    const pdf = await readFile(outputPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new DocumentPdfError("Document renderer returned invalid PDF data", execution.stderr);
    }

    return {
      pdf,
      pages: metadata.pages,
      renderer: metadata.renderer,
      variant: metadata.variant,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
