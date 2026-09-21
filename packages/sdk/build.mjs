import { execFileSync } from "node:child_process";
// Two bundles and two sets of declarations. esbuild does the JavaScript; tsc
// does the types; the .d.cts copies are what a `require()` from TypeScript
// under node16 resolution looks for, and their relative specifiers have to
// point at each other rather than back at the ESM tree.
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "neutral",
  target: ["es2022", "node18"],
  sourcemap: true,
  logLevel: "info",
};

await build({ ...shared, format: "esm", outfile: "dist/index.js" });
await build({ ...shared, format: "cjs", outfile: "dist/index.cjs" });

execFileSync(process.platform === "win32" ? "tsc.cmd" : "tsc", ["-p", "tsconfig.json"], {
  stdio: "inherit",
});

for (const file of walk("dist")) {
  if (!file.endsWith(".d.ts")) continue;
  const source = readFileSync(file, "utf8");
  // Only the specifiers in `from "…"` clauses, which all end in .js.
  const rewritten = source.replace(/(from\s+")(\.[^"]*)\.js(")/g, "$1$2.cjs$3");
  writeFileSync(file.replace(/\.d\.ts$/, ".d.cts"), rewritten);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
