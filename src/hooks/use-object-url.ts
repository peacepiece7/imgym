import { useCallback, useEffect, useRef, useState } from "react";

export function useObjectUrl() {
  const [url, setUrl] = useState("");
  const currentUrl = useRef("");
  const mounted = useRef(true);

  const replaceBlob = useCallback((blob: Blob | null) => {
    if (!mounted.current) return;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : "";
    currentUrl.current = nextUrl;
    setUrl(nextUrl);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = "";
    };
  }, []);

  return [url, replaceBlob] as const;
}
