import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STDOUT_LIMIT = 32 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;
const PROCESS_TIMEOUT_MS = 35_000;

export const MAGICK_LIMIT_ARGS = [
  "-limit", "width", "8192",
  "-limit", "height", "8192",
  "-limit", "area", "25MP",
  "-limit", "thread", "2",
  "-limit", "memory", "256MiB",
  "-limit", "map", "512MiB",
  "-limit", "disk", "1GiB",
  "-limit", "file", "64",
  "-limit", "time", "30",
] as const;

export class ImageMagickError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "ImageMagickError";
  }
}

interface RunMagickOptions {
  input?: Uint8Array;
  signal?: AbortSignal;
  temporaryDirectory?: string;
  stdoutLimit?: number;
}

interface MagickOutput {
  stdout: Buffer;
  stderr: string;
}

export async function withMagickTempDirectory<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "ohmyimg-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function readMagickOutputFile(path: string, limit = STDOUT_LIMIT) {
  const file = await stat(path);
  if (!file.isFile() || file.size > limit) {
    throw new ImageMagickError("ImageMagick output exceeded the limit");
  }
  const output = await readFile(path);
  if (output.byteLength > limit) {
    throw new ImageMagickError("ImageMagick output exceeded the limit");
  }
  return output;
}

export async function runMagick(
  args: readonly string[],
  options: RunMagickOptions = {},
): Promise<MagickOutput> {
  if (options.signal?.aborted) {
    throw new ImageMagickError("ImageMagick was cancelled");
  }
  if (!options.temporaryDirectory) {
    return withMagickTempDirectory((temporaryDirectory) =>
      runMagick(args, { ...options, temporaryDirectory }),
    );
  }

  const binary = process.env.IMAGEMAGICK_BINARY || "magick";
  const outputLimit = options.stdoutLimit ?? STDOUT_LIMIT;
  const useProcessGroup = process.platform !== "win32";
  const childEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL,
    DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH,
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    FONTCONFIG_FILE: process.env.FONTCONFIG_FILE,
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
    MAGICK_CONFIGURE_PATH: process.env.MAGICK_CONFIGURE_PATH,
    MAGICK_CODER_MODULE_PATH: process.env.MAGICK_CODER_MODULE_PATH,
    MAGICK_HOME: process.env.MAGICK_HOME,
    MAGICK_TEMPORARY_PATH: options.temporaryDirectory,
    TMPDIR: options.temporaryDirectory,
    XDG_CACHE_HOME: options.temporaryDirectory,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ binary, [...args], {
      shell: false,
      detached: useProcessGroup,
      cwd: options.temporaryDirectory,
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: ImageMagickError | null = null;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (signal: NodeJS.Signals) => {
      if (useProcessGroup && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch {
          // Fall back to the direct child when no process group was created.
        }
      }
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    };
    const fail = (error: ImageMagickError) => {
      if (failure) return;
      failure = error;
      if (!terminate("SIGTERM")) return;
      killTimer = setTimeout(() => {
        terminate("SIGKILL");
      }, 1_000);
      killTimer.unref?.();
    };
    const abort = () => fail(new ImageMagickError("ImageMagick was cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => fail(new ImageMagickError("ImageMagick timed out")), PROCESS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > outputLimit) {
        fail(new ImageMagickError("ImageMagick output exceeded the limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, STDERR_LIMIT - stderrBytes);
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
      stderrBytes += chunk.byteLength;
      if (stderrBytes > STDERR_LIMIT) fail(new ImageMagickError("ImageMagick diagnostics exceeded the limit"));
    });
    child.stdin.on("error", () => {
      // EPIPE is expected if ImageMagick exits before consuming all input.
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer && !failure) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      reject(failure ?? new ImageMagickError("Could not start ImageMagick", String(error)));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer && (!failure || !useProcessGroup)) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
      if (failure) {
        reject(new ImageMagickError(failure.message, diagnostics));
      } else if (code !== 0) {
        reject(new ImageMagickError(`ImageMagick exited with ${code ?? signal ?? "an error"}`, diagnostics));
      } else {
        resolve({ stdout: Buffer.concat(stdout), stderr: diagnostics });
      }
    });

    child.stdin.end(options.input);
  });
}
