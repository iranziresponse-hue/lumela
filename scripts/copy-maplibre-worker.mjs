// maplibre-gl v6 ships its tile-parsing worker as a separate module
// (maplibre-gl-worker.mjs) that imports a sibling (maplibre-gl-shared.mjs).
// Next.js's webpack asset-module handling for `new URL(..., import.meta.url)`
// copies only the file it's pointed at, not that sibling import, so the
// worker 404s on its own first import and vector tiles never load. Serving
// both files as-is from /public sidesteps webpack's asset pipeline entirely.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../node_modules/maplibre-gl/dist");
const destDir = join(here, "../public/maplibre");

mkdirSync(destDir, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}

console.log("Copied maplibre-gl worker files to public/maplibre/");
