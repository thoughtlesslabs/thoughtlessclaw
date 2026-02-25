import { initVault, readVaultFile, writeVaultFile } from "./store.js";
import { startCoordinator } from "../managers/coordinator.js";
import { checkBloodPressure } from "../economics/blood-pressure.js";
import { getViolations } from "../correction/violation-tracker.js";

// The Immortal Wakeup Procedure
export async function wakeUp() {
  console.log(`=========================================`);
  console.log(`[Skynet] Waking up sequence initiated...`);
  console.log(`=========================================`);
  
  await initVault();

  // Read corrections directly into active context
  const violations = await getViolations();
  if (violations.length > 0) {
    console.log(`[Skynet] Loaded ${violations.length} past violations. Modifying executive prompts to prevent recurrence.`);
  }

  // 1. Read last task
  const lastTask = await readVaultFile("tasks/last-task.md");
  if (lastTask) {
    console.log("[Skynet] Resuming pending follow-ups from last task...");
    await startCoordinator(lastTask);
  } else {
    console.log("[Skynet] No pending tasks found. Checking inbox...");
    const inboxItems = await readVaultFile("inbox/requests.json");
    if (inboxItems) {
      try {
        const requests = JSON.parse(inboxItems);
        if (requests.length > 0) {
          console.log(`[Skynet] Found ${requests.length} new requests.`);
          await startCoordinator(JSON.stringify(requests[0]));
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

  // 2. Health check / Monitor
  console.log("\n[Skynet] Running automated health checks...");
  await checkBloodPressure();

  // 3. Heartbeat
  const timestamp = new Date().toISOString();
  await writeVaultFile("heartbeats/latest.json", JSON.stringify({ lastWake: timestamp, status: "alive" }));
  
  console.log(`\n[Skynet] Heartbeat recorded at ${timestamp}. Tasks complete. Going to sleep.`);
  console.log(`=========================================`);
}
