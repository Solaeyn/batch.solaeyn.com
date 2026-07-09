import { build, context } from "esbuild";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const watchMode = process.argv.includes("--watch");
const minify = process.argv.includes("--minify") || process.env.NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

function collectTsxFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectTsxFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

const entryPoints = collectTsxFiles(publicDir);

if (!entryPoints.length) {
  console.log("No TSX client files found under public/. Nothing to build.");
  process.exit(0);
}

const buildOptions = {
  entryPoints,
  outbase: publicDir,
  outdir: publicDir,
  bundle: false,
  sourcemap: false,
  minify,
  legalComments: minify ? "none" : "inline",
  target: ["es2020"],
  logLevel: "info"
};

if (watchMode) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("Client TSX watcher started.");
} else {
  await build(buildOptions);
}
