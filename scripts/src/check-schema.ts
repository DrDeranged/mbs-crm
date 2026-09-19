import { dropThrowawayDatabase, createThrowawayDatabase, makeThrowawayDatabaseName } from "./throwawayDatabase";
import { run } from "./process";

const baseConnectionString = process.env.DATABASE_URL;
if (!baseConnectionString) {
  throw new Error("DATABASE_URL is required to create the schema-check database");
}

const configuredTarget = process.env.SCHEMA_CHECK_DATABASE_URL;
if (configuredTarget) {
  await run(
    "pnpm",
    ["--filter", "@workspace/scripts", "exec", "tsx", "../lib/db/src/schemaCiCheck.ts"],
    { env: process.env },
  );
} else {
  const databaseName = makeThrowawayDatabaseName("schema_ci");
  const targetUrl = await createThrowawayDatabase(baseConnectionString, databaseName);
  try {
    await run(
      "pnpm",
      ["--filter", "@workspace/scripts", "exec", "tsx", "../lib/db/src/schemaCiCheck.ts"],
      { env: { ...process.env, SCHEMA_CHECK_DATABASE_URL: targetUrl } },
    );
  } finally {
    await dropThrowawayDatabase(baseConnectionString, databaseName);
  }
}