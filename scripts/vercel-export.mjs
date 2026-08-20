/**
 * Copy the static app into public/ for Vercel. API routes stay at /api.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public");

const stats = spawnSync(process.execPath, [join(root, "scripts", "stats-about.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (stats.status !== 0) {
  process.exit(stats.status || 1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const files = [
  "index.html",
  "about.html",
  "styles.css",
  "app.js",
  "shared.js",
  "context.js",
  "engagement.js",
  "authority.js",
  "spend-year.js",
  "apple-touch-icon.png",
  "apple-touch-icon-cascade.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon-cascade-192.png",
  "icon-cascade-512.png",
  "icon-cascade-maskable-512.png",
  "robots.txt",
  "sitemap.xml",
];
const dirs = ["views", "vendor", "data/nested"];

for (const f of files) {
  cpSync(join(root, f), join(dest, f));
}
for (const d of dirs) {
  cpSync(join(root, d), join(dest, d), { recursive: true });
}

const popSrc = join(root, "data", "raw", "census", "us-population.json");
const popDest = join(dest, "data", "raw", "census", "us-population.json");
mkdirSync(join(dest, "data", "raw", "census"), { recursive: true });
cpSync(popSrc, popDest);

console.log("Vercel static export →", dest);
