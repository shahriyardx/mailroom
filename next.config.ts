import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/** One version, read from the manifest rather than written down twice. */
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

const config: NextConfig = {
  // Lets a verification build run without clobbering the .next directory a dev
  // server is using: NEXT_DIST_DIR=.next-verify next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Emits a self-contained server bundle, so the runtime image carries only
  // what is actually imported.
  output: "standalone",
  // Baked in rather than read at boot: what is running is decided when the
  // image is built, and nothing at runtime can tell you otherwise.
  env: { APP_VERSION: version },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default config;
