const DEFAULT_MAX_CONCURRENT_JOBS = 1;
const MAX_CONFIGURED_CONCURRENT_JOBS = 4;

let activeJobs = 0;
let warnedAboutInvalidConfiguration = false;

function configuredLimit() {
  const configured = process.env.OHMYIMG_MAX_CONCURRENT_JOBS;
  if (configured === undefined) return DEFAULT_MAX_CONCURRENT_JOBS;

  const parsed = Number(configured);
  if (
    Number.isInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_CONFIGURED_CONCURRENT_JOBS
  ) {
    return parsed;
  }

  if (!warnedAboutInvalidConfiguration) {
    console.warn("[api-job-gate]", {
      error: "invalid-concurrency-configuration",
      fallback: DEFAULT_MAX_CONCURRENT_JOBS,
    });
    warnedAboutInvalidConfiguration = true;
  }
  return DEFAULT_MAX_CONCURRENT_JOBS;
}

export function tryAcquireJobPermit(): (() => void) | null {
  if (activeJobs >= configuredLimit()) return null;
  activeJobs += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeJobs = Math.max(0, activeJobs - 1);
  };
}

export function jobBusyResponse(requestId: string) {
  return Response.json(
    { error: "Server is busy. Try again later.", requestId },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "1",
        "X-Request-Id": requestId,
      },
    },
  );
}
