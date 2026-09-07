import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 1024 * 1024;
const PROCESS_TIMEOUT_MS = 60_000;

export async function runAssetProcess(
  binary: string,
  args: readonly string[],
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error("Asset process was cancelled");
  const useProcessGroup = process.platform !== "win32";
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL,
    TMPDIR: temporaryDirectory,
    XDG_CACHE_HOME: temporaryDirectory,
    FONTCONFIG_FILE: process.env.FONTCONFIG_FILE,
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH,
  };
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, [...args], { shell: false, detached: useProcessGroup, cwd: temporaryDirectory, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | null = null;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (kind: NodeJS.Signals) => {
      try {
        if (useProcessGroup && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {
        // The process may already have exited.
      }
    };
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
      killTimer.unref?.();
    };
    const abort = () => fail(new Error("Asset process was cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => fail(new Error("Asset process timed out")), PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > OUTPUT_LIMIT) fail(new Error("Asset process output exceeded the limit"));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > OUTPUT_LIMIT) fail(new Error("Asset process diagnostics exceeded the limit"));
      else stderr.push(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer && !failure) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      reject(failure ?? new Error(`Could not start ${binary}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer && (!failure || !useProcessGroup)) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${binary} failed${diagnostics ? `: ${diagnostics.slice(0, 500)}` : ""}`));
      else resolve({ stdout: Buffer.concat(stdout), stderr: diagnostics });
    });
  });
}
