import type { NextConfig } from "next";

const config: NextConfig = {
  // Emits a self-contained server bundle, so the runtime image carries only
  // what is actually imported.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default config;
