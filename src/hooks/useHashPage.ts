import { useSyncExternalStore } from "react";

export type PageId = "overview" | "alerts" | "settings";
const PAGES: PageId[] = ["overview", "alerts", "settings"];

function readPage(): PageId {
  const id = window.location.hash.replace(/^#\/?/, "");
  return (PAGES as string[]).includes(id) ? (id as PageId) : "overview";
}

/** The current page, from the address (#/settings). No router needed. */
export function useHashPage(): PageId {
  return useSyncExternalStore((onChange) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, readPage);
}
