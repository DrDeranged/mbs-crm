import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve alongside the module, not the server's working directory.
 * In source the module lives under src/lib; in the split build it lives under
 * dist/chunks (or, if unsplit, directly under dist). */
export function readPackagedAsset(filename: string): Buffer {
  for (const relative of [`../assets/${filename}`, `./assets/${filename}`]) {
    try {
      return readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Could not read packaged asset ${filename}`);
}