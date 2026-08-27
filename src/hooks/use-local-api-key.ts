"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ohmyimgapikey";
const listeners = new Set<() => void>();
let memoryFallback = "";

function getSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memoryFallback;
  }
}

function getServerSnapshot() {
  return "";
}

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  }

  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function setLocalApiKey(value: string) {
  memoryFallback = value;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Some privacy modes disable localStorage; keep the key in page memory instead.
  }
  for (const listener of listeners) listener();
}

export function useLocalApiKey() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
