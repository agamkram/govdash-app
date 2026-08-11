/**
 * Copy the static app into public/ for Vercel. API routes stay at /api.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "shared.js",
  "context.js",
  "engagement.js",
  "sankey.html",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
];
const dirs = ["views", "vendor", "data/nested"];

for (const f of files) {
  cpSync(join(root, f), join(dest, f));
}
for (const d of dirs) {
  cpSync(join(root, d), join(dest, d), { recursive: true });
}

console.log("Vercel static export →", dest);
