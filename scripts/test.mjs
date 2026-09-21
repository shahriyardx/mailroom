/**
 * Builds the tests in `test/` and runs them on Node's own runner.
 *
 * The server modules are written for Next: they import `server-only`, and they
 * reach for each other through the `@/` alias. Neither survives plain `node`,
 * so the tests are bundled first with both taught to esbuild — and with
 * `@/lib/ses` swapped for a fake, which is the one thing a test must not call
 * for real.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, ".test-build");

/** The alias is written the way an import is, without the part on disk. */
function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Modules the tests must never reach the real version of. */
const DOUBLES = {
  "@/lib/ses": join(root, "test/fakes/ses.ts"),
};

const shims = {
  name: "test-shims",
  setup(build) {
    // `server-only` throws outside a React Server Component. Nothing here is
    // a component, and the point of the import is a build-time guard.
    build.onResolve({ filter: /^server-only$/ }, () => ({
      path: "server-only",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};" }));

    build.onResolve({ filter: /^@\// }, (args) => {
      const double = DOUBLES[args.path];
      if (double) return { path: double };
      return { path: withExtension(join(root, "src", args.path.slice(2))) };
    });
  },
};

const files = walk(join(root, "test")).filter((path) => !path.includes("/fakes/"));
if (files.length === 0) {
  console.error("no tests found");
  process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: files,
  outdir,
  outbase: join(root, "test"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "inline",
  // Everything from node_modules stays where it is; only our own code is
  // pulled in, which is what the aliases above are for.
  packages: "external",
  plugins: [shims],
});

// Node's runner wants the files, not the folder they are in.
const built = files.map((path) =>
  join(outdir, path.slice(join(root, "test").length + 1).replace(/\.ts$/, ".js")),
);

const child = spawn(process.execPath, ["--test", ...process.argv.slice(2), ...built], {
  stdio: "inherit",
  cwd: root,
});
child.on("exit", (code) => process.exit(code ?? 1));
