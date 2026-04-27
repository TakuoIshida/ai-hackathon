import { app } from "./app";
import { assertProductionConfig, config } from "./config";

// ISH-128: surface missing required env at boot rather than at first request.
assertProductionConfig();

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  development: !config.isProduction,
});

console.info(`🚀 api listening on http://localhost:${server.port}`);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`received ${signal}, draining connections...`);
  await server.stop(); // wait for in-flight requests
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
