import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultCloneConfig, startManagedCloneServer, stopManagedCloneServer } from "./dbCloneProd";
import { localPostgresUrl } from "./localPostgres";
import { run } from "./process";

export async function rehearsePublishSync(): Promise<void> {
  // A nested source checkout can exceed PostgreSQL's Unix socket path limit.
  // This owns a disposable cluster only; never use any workspace database.
  const workspace = await mkdtemp(path.join(tmpdir(), "mbs-attribution-"));
  const config = defaultCloneConfig(workspace);
  config.port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject).listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
  config.log = () => {};
  try {
    try {
      await startManagedCloneServer(config);
    } catch (error) {
      console.error(await readFile(config.logFile, "utf8").catch(() => "No simulator startup log"));
      throw error;
    }
    await run("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "../lib/db/src/attributionRehearsal.ts"], {
      env: { ...process.env, ATTRIBUTION_REHEARSAL_BASE_URL: localPostgresUrl(config.port, "postgres"),
        ATTRIBUTION_REHEARSAL_PG_LOG: config.logFile },
    });
  } finally {
    await stopManagedCloneServer(config);
    await rm(workspace, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await rehearsePublishSync();
