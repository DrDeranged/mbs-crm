import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
class File {
  constructor(bucket, name) {
    const root = process.env.VISUAL_FIXTURE_STORAGE_DIR;
    if (!root) throw new Error("Disposable fixture storage directory required.");
    this.path = resolve(root, bucket, name);
    if (!this.path.startsWith(resolve(root) + "/")) throw new Error("Unsafe fixture path.");
    this.name = name;
  }
  async save(bytes, metadata = {}) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, bytes);
    await writeFile(this.path + ".metadata.json", JSON.stringify({ size: bytes.length, contentType: metadata.contentType ?? metadata.metadata?.contentType ?? "application/octet-stream" }));
  }
  async exists() { try { await access(this.path); return [true]; } catch { return [false]; } }
  async getMetadata() { return [JSON.parse(await readFile(this.path + ".metadata.json", "utf8"))]; }
  async download() { return [await readFile(this.path)]; }
  createReadStream() { return createReadStream(this.path); }
}
export class Storage {
  bucket(name) { return { file: key => new File(name || "fixture-bucket", key) }; }
}