/**
 * Builds the tests in `test/` and runs them on Node's own runner.
 *
 * The server modules are written for Next: they import `server-only`, and they
 * reach for each other through the `@/` alias. Neither survives plain `node`,
 * so the tests are bundled first with both taught to esbuild — and with
 * `@/lib/ses` swapped for a fake, which is the one thing a test must not call
 * for real.
 */
import { execFileSync, spawn } from "node:child_process";
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

/** Framework modules that cannot load outside `next dev`, stood in for. */
const STUBS = {
  "next/server": join(root, "test/fakes/next-server.ts"),
  "next/link": join(root, "test/fakes/next-link.tsx"),
  "next/headers": join(root, "test/fakes/next-headers.ts"),
  "next/navigation": join(root, "test/fakes/next-navigation.ts"),
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

    build.onResolve({ filter: /^next\// }, (args) => {
      const stub = STUBS[args.path];
      return stub ? { path: stub } : undefined;
    });

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
  // The documentation renderer is JSX, and a test that renders it needs the
  // modern transform rather than a React import in every file.
  jsx: "automatic",
  // Everything from node_modules stays where it is; only our own code is
  // pulled in, which is what the aliases above are for.
  packages: "external",
  plugins: [shims],
});

// Node's runner wants the files, not the folder they are in.
const built = files.map((path) =>
  join(outdir, path.slice(join(root, "test").length + 1).replace(/\.ts$/, ".js")),
);

/*
 * One migrated database, copied per test file.
 *
 * Running the migrations once per file meant spawning drizzle-kit three times
 * and paying for it three times. Postgres will copy a database wholesale, so
 * the migrations run once here and each file gets a copy in a few
 * milliseconds.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://mail:mail@localhost:5433/postgres";
const TEMPLATE = "mail_test_template";

function psql(url, statement) {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe" });
}

function templateUrl(name) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

psql(ADMIN_URL, `DROP DATABASE IF EXISTS "${TEMPLATE}"`);
psql(ADMIN_URL, `CREATE DATABASE "${TEMPLATE}"`);
execFileSync("npx", ["drizzle-kit", "migrate"], {
  env: { ...process.env, DATABASE_URL: templateUrl(TEMPLATE) },
  stdio: "pipe",
});

// One file at a time. They each hold a database and a connection pool, and
// running them together turned a slow migration into a flaky test.
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...process.argv.slice(2), ...built],
  {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, TEST_TEMPLATE_DB: TEMPLATE, TEST_ADMIN_URL: ADMIN_URL },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
