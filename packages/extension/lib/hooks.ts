import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { type Settings, getSettings, saveSettings } from "./settings";

/**
 * The stored settings, kept in step across every page of the extension.
 *
 * The popup and the options tab can both be open, and a change in one has to
 * reach the other — so this reads through `storage.onChanged` rather than
 * holding a private copy.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let alive = true;
    void getSettings().then((value) => {
      if (alive) setSettings(value);
    });

    const onChange = (changes: Record<string, { newValue?: unknown }>) => {
      if (!changes.settings) return;
      void getSettings().then((value) => {
        if (alive) setSettings(value);
      });
    };

    browser.storage.local.onChanged.addListener(onChange);
    return () => {
      alive = false;
      browser.storage.local.onChanged.removeListener(onChange);
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, update };
}

/**
 * Whether to draw the dark palette, following the choice and then the system.
 *
 * Applied to `documentElement` rather than passed down, because the email
 * frame reads the class off the root to decide its own colours.
 */
export function useTheme(preference: Settings["theme"] | undefined) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const wanted = preference === "dark" || (preference !== "light" && media.matches);
      setDark(wanted);
      document.documentElement.classList.toggle("dark", wanted);
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return dark;
}

/** Debounces a value, so typing in the search box is not a call per letter. */
export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/** Asks the background worker to poll now, and forgets about the answer. */
export function refreshBadge() {
  void browser.runtime.sendMessage({ type: "poll" }).catch(() => {});
}

/** Opens a dashboard URL in a tab and closes the popup behind it. */
export function openTab(url: string) {
  void browser.tabs.create({ url }).then(() => window.close());
}
