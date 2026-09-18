type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

function anchorDownload(blob: Blob, suggestedName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return "memory" as const;
}

export async function saveZipResponse(response: Response, suggestedName: string) {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker && response.body) {
    let handle: Awaited<ReturnType<SaveFilePicker>> | null = null;
    try {
      handle = await picker({ suggestedName, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] });
    } catch (error) {
      // Only a cancel is the user's answer. Everything else — above all
      // "Must be handling a user gesture", thrown once building the pack
      // outlives the click that started it — falls back to the anchor.
      if (error instanceof DOMException && error.name === "AbortError") {
        await response.body.cancel().catch(() => undefined);
        throw error;
      }
    }
    if (handle) {
      try {
        await response.body.pipeTo(await handle.createWritable());
        return "disk" as const;
      } catch (error) {
        await response.body.cancel().catch(() => undefined);
        throw error;
      }
    }
  }
  return anchorDownload(await response.blob(), suggestedName);
}
