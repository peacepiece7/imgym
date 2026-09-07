type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

export async function saveZipResponse(response: Response, suggestedName: string) {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker && response.body) {
    try {
      const handle = await picker({ suggestedName, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] });
      await response.body.pipeTo(await handle.createWritable());
      return "disk" as const;
    } catch (error) {
      await response.body.cancel().catch(() => undefined);
      throw error;
    }
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return "memory" as const;
}
