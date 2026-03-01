import { initVault, readVaultFile, writeVaultFile } from "./store.js";

// The Immortal Wakeup Procedure
export async function wakeUp() {
  console.log(`=========================================`);
  console.log(`[Skynet] Waking up sequence initiated...`);
  console.log(`=========================================`);

  await initVault();

  // Read last task
  const lastTask = await readVaultFile("tasks/last-task.md");
  if (lastTask) {
    console.log("[Skynet] Resuming pending follow-ups from last task...");
  } else {
    console.log("[Skynet] No pending tasks found. Checking inbox...");
    const inboxItems = await readVaultFile("inbox/requests.json");
    if (inboxItems) {
      try {
        const requests = JSON.parse(inboxItems);
        if (requests.length > 0) {
          console.log(`[Skynet] Found ${requests.length} new requests.`);
        } else {
          console.log("[Skynet] Inbox empty.");
        }
      } catch (e) {
        console.log("[Skynet] Error parsing inbox requests.", e);
      }
    } else {
      console.log("[Skynet] Inbox does not exist on disk.");
    }
  }

  // Heartbeat
  const timestamp = new Date().toISOString();
  await writeVaultFile(
    "heartbeats/latest.json",
    JSON.stringify({ lastWake: timestamp, status: "alive" }),
  );

  console.log(`\n[Skynet] Heartbeat recorded at ${timestamp}. Tasks complete. Going to sleep.`);
  console.log(`=========================================`);
}
