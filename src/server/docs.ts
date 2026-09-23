import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOC_PAGES, type DocPage, pageForSlug } from "@/lib/docs-nav";

/**
 * The documentation, read from the repository it is written in.
 *
 * The same Markdown the published site is built from, served by the app
 * itself. Somebody self-hosting this behind their own firewall — or on a
 * machine with no way out to the internet at all — should not have to leave
 * the instance to find out how it works, and a link to a website is a link
 * that can rot, change under them, or describe a version they are not running.
 *
 * Only paths named in the menu are ever opened, so a URL cannot reach for a
 * file outside the folder.
 */

const ROOT = join(process.cwd(), "docs");

export async function docSource(page: DocPage): Promise<string | null> {
  try {
    return await readFile(join(ROOT, `${page.path}.md`), "utf8");
  } catch {
    // A page in the menu whose file is missing is a broken build, not a
    // request worth erroring the whole screen over.
    return null;
  }
}

export function docForSlug(slug: string[] | undefined) {
  return slug && slug.length > 0 ? pageForSlug(slug) : null;
}

/** The page before and after this one, in menu order. */
export function neighbours(page: DocPage) {
  const at = DOC_PAGES.findIndex((entry) => entry.path === page.path);
  return {
    previous: at > 0 ? DOC_PAGES[at - 1] : null,
    next: at >= 0 && at < DOC_PAGES.length - 1 ? DOC_PAGES[at + 1] : null,
  };
}
