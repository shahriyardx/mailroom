import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

/**
 * One source, three browsers.
 *
 * WXT writes the per-browser manifest, so the differences between Chrome,
 * Edge and Firefox stay here instead of being spread through the code. MV3 is
 * pinned for every target: Firefox has supported it since 109, and letting it
 * fall back to MV2 would mean two background models to reason about.
 */
export default defineConfig({
  // React is wired through Vite directly rather than through WXT's React
  // module: that module pulls a plugin build for a newer Vite than WXT itself
  // depends on, and the two cannot both be right in one install.
  srcDir: ".",
  outDir: ".output",
  manifest: {
    name: "Mailroom",
    short_name: "Mailroom",
    description: "Your Mailroom inbox in the toolbar: new mail notifications, read and triage.",
    // The base URL is whatever the reader self-hosts, so it cannot be named
    // up front. The host permission is asked for on the connect screen and
    // narrowed to that one origin.
    permissions: ["storage", "alarms", "notifications"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    action: {
      default_title: "Mailroom",
    },
    // A real tab, not the panel inside the add-ons page: the connect screen
    // asks for a host permission, and a prompt raised from a cramped embedded
    // frame is both hard to read and easy to lose the half-filled form to.
    options_ui: {
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: "mailroom@shahriyar.dev",
        strict_min_version: "115.0",
      },
    },
  },
  manifestVersion: 3,
  vite: () => ({
    plugins: [react(), tailwindcss()],
  }),
});
