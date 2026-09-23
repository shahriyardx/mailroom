/**
 * Draws the social icons the builder offers, as PNG files.
 *
 * PNG because a mail client will not render an SVG — Gmail strips them — and
 * will not fetch a data: URI either, so the icons have to be real files at a
 * real address. They are drawn from lucide, which this app already uses
 * everywhere else, so a footer looks like the rest of the product rather than
 * like a sheet of borrowed brand assets.
 *
 * Two tones, because a PNG cannot be recoloured by the email that holds it and
 * a dark icon on a dark background is not there.
 *
 *   node scripts/social-icons.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "node_modules/lucide-react/dist/esm/icons");
const out = join(root, "public/social");

/** Which lucide icon stands for which network. */
const NETWORKS = {
  x: "twitter",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  youtube: "youtube",
  github: "github",
  twitch: "twitch",
  slack: "slack",
  dribbble: "dribbble",
  figma: "figma",
  rss: "rss",
  website: "globe",
  email: "mail",
};

const TONES = { dark: "#3f3f46", light: "#ffffff" };

/** The drawing instructions out of the icon module, without running React. */
function nodesOf(name) {
  const source = readFileSync(join(icons, `${name}.js`), "utf8");
  const start = source.indexOf("[", source.indexOf("createLucideIcon("));
  const end = source.lastIndexOf("]);");
  // A literal array in a file this project installed. Read as what it is.
  return new Function(`return ${source.slice(start, end + 1)}`)();
}

function svgOf(name, colour) {
  const body = nodesOf(name)
    .map(([tag, attrs]) => {
      const written = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");
      return `<${tag} ${written} />`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

mkdirSync(out, { recursive: true });

for (const [network, icon] of Object.entries(NETWORKS)) {
  for (const [tone, colour] of Object.entries(TONES)) {
    const svg = join(out, `${network}-${tone}.svg`);
    writeFileSync(svg, svgOf(icon, colour));
    // Drawn at 48 so it is still sharp on the screens that ask for two
    // pixels per pixel, and shown at 24.
    execFileSync("rsvg-convert", [
      "-w",
      "48",
      "-h",
      "48",
      "-o",
      join(out, `${network}-${tone}.png`),
      svg,
    ]);
    execFileSync("rm", [svg]);
  }
}

console.log(`Drew ${Object.keys(NETWORKS).length * 2} icons into public/social`);
