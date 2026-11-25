import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  conditions: ["worker", "browser"],
  mainFields: ["module", "main"],
  logLevel: "info",
});

const compatibilityDate = "2025-09-01";

await writeFile(
  "dist/manifest.json",
  JSON.stringify(
    {
      entrypoint: "worker.js",
      compatibilityDate,
      modules: [{ name: "worker.js", type: "esm", path: "./worker.js" }],
      assetsDirectory: "./client",
      spa: true,
    },
    null,
    2,
  ),
);

console.log("Built dist/worker.js, dist/client and dist/manifest.json");
