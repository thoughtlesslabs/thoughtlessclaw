#!/usr/bin/env node
import { createSkynet, createInboxServer } from "../src/skynet/index.js";

export async function skynetMain() {
  console.log("[Skynet] Starting autonomous OS...");

  const port = parseInt(process.env.SKYNET_API_PORT || "18790");
  const heartbeatMs = parseInt(process.env.SKYNET_HEARTBEAT_MS || "60000");
  const idleMs = parseInt(process.env.SKYNET_IDLE_MS || "300000");
  const tokenBudget = parseInt(process.env.SKYNET_TOKEN_BUDGET || "1000000");

  const skynet = createSkynet({
    vaultPath: process.env.SKYNET_VAULT_PATH || "~/.skynet/vault",
    heartbeatIntervalMs: heartbeatMs,
    idleSleepThresholdMs: idleMs,
    defaultTokenBudget: tokenBudget,
  });

  await skynet.initialize();

  const inboxServer = createInboxServer(skynet, { port });
  await inboxServer.start();

  await skynet.start();

  console.log(`[Skynet] Running. API at http://localhost:${port}`);
  console.log("[Skynet] Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    console.log("\n[Skynet] Shutting down...");
    await skynet.stop();
    await inboxServer.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n[Skynet] Shutting down...");
    await skynet.stop();
    await inboxServer.stop();
    process.exit(0);
  });
}

skynetMain().catch((err: unknown) => {
  console.error("[Skynet] Fatal error:", err);
  process.exit(1);
});
