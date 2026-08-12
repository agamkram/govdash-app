#!/usr/bin/env node
/**
 * Fetch latest OPM FWD employment parquet and aggregate to JSON.
 *
 * Usage:
 *   npm run fetch:workforce
 *   npm run fetch:workforce -- --force
 */
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "workforce");
const API = "https://data.opm.gov/api/v1/files/employment";

function parseArgs(argv) {
  return { force: argv.includes("--force") };
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function main() {
  const { force } = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  const listRes = await fetch(`${API}?current=true`);
  if (!listRes.ok) throw new Error(`OPM list failed: ${listRes.status}`);
  const files = await listRes.json();
  if (!Array.isArray(files) || !files.length) throw new Error("No employment files");

  files.sort((a, b) => {
    const ay = Number(a.year);
    const by = Number(b.year);
    if (ay !== by) return by - ay;
    return Number(b.month) - Number(a.month);
  });
  const latest = files[0];
  const year = latest.year;
  const month = String(latest.month).padStart(2, "0");
  const version = latest.version;
  const parquetName = `employment_${year}${month}_${version}.parquet`;
  const parquetPath = join(OUT, parquetName);
  const jsonPath = join(OUT, "opm-employment-counts.json");
  const metaPath = join(OUT, "manifest.json");

  if (!(await exists(parquetPath)) || force) {
    const url = `${API}/${year}/${month}/${version}/download`;
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OPM download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(parquetPath, buf);
    console.log(`Wrote ${parquetPath} (${(buf.length / 1e6).toFixed(1)} MB)`);
  } else {
    console.log(`Using cached ${parquetPath}`);
  }

  await run("python3", [
    join(ROOT, "scripts", "aggregate-opm-workforce.py"),
    parquetPath,
    jsonPath,
  ]);

  await writeFile(
    metaPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        year,
        month,
        version,
        filename: latest.filename,
        publishDate: latest.publishDate,
        parquet: parquetName,
        counts: "opm-employment-counts.json",
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Manifest → ${metaPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
