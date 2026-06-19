import app from "./app";
import { logger } from "./lib/logger";
import { runDripJob } from "./lib/dripJob";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Drip email background job — runs every 10 minutes
  const DRIP_INTERVAL_MS = 10 * 60 * 1000;
  runDripJob().catch((err) => logger.error({ err }, "Drip job startup error"));
  setInterval(() => {
    runDripJob().catch((err) => logger.error({ err }, "Drip job error"));
  }, DRIP_INTERVAL_MS);
});
