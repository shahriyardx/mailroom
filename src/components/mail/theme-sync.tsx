"use client";

import type { Appearance } from "@/server/preferences";
import { useEffect } from "react";

/**
 * Puts the saved theme on the document.
 *
 * The pre-paint script in the root layout reads local storage, which a device
 * signing in for the first time has nothing in. This is the saved answer
 * arriving a moment later, and it writes the mirror so the next load is right
 * before any of this runs.
 */
export function ThemeSync({ theme }: { theme: Appearance["theme"] }) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };

    apply();
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Storage refused: the theme still applies, it just is not remembered.
    }

    // Only "system" cares what the device does afterwards.
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return null;
}
