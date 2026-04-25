import { app } from "./app";

const port = Number(process.env.PORT ?? 8787);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  development: process.env.NODE_ENV !== "production",
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
