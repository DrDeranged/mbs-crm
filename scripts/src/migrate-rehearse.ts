import path from "node:path";
import {
  defaultCloneConfig,
  startExistingManagedCloneServer,
  stopManagedCloneServer,
  type CloneConfig,
} from "./dbCloneProd";
import { assertLocalPostgresUrl, localPostgresUrl } from "./localPostgres";
import { formatFailedLine, run } from "./process";

const config = defaultCloneConfig(path.resolve(import.meta.dirname, "../.."));
export async function runManagedRehearsal(
  targetUrl: string,
  execute: (url: string) => Promise<void> = async (url) => {
    await run("pnpm", ["exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"], {
      env: { ...process.env, MIGRATION_REHEARSAL_DATABASE_URL: url },
    });
  },
  cloneConfig: CloneConfig = config,
): Promise<void> {
  let startedByCaller = false;
  try {
    ({ startedByCaller } = await startExistingManagedCloneServer(cloneConfig));
    await execute(targetUrl);
  } finally {
    if (startedByCaller) await stopManagedCloneServer(cloneConfig);
  }
}
async function main(): Promise<void> {
 try {
  const targetUrl = localPostgresUrl(config.port, config.database);
  assertLocalPostgresUrl(targetUrl);
  await runManagedRehearsal(targetUrl);
  console.log("MIGRATION REHEARSAL PASS");
} catch (error) {
   console.error(formatFailedLine("MIGRATION REHEARSAL", error));
  process.exitCode = 1;
 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();