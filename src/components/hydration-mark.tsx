"use client";

import { useEffect } from "react";

// Canonical hydration signal for e2e: React effects run only after hydration,
// so this attribute marks the moment client listeners are attached. Specs wait
// on it before synthesizing events (drag/drop, Enter-to-send) that a
// pre-hydration dispatch would silently swallow on slow runners.
export function HydrationMark() {
  useEffect(() => {
    document.documentElement.dataset.appHydrated = "1";
  }, []);
  return null;
}
