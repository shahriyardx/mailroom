import type { NextConfig } from "next";

const config: NextConfig = {
  // Lets a verification build run without clobbering the .next directory a dev
  // server is using: NEXT_DIST_DIR=.next-verify next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Emits a self-contained server bundle, so the runtime image carries only
  // what is actually imported.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default config;
