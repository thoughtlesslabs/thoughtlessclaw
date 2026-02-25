import { conveneCouncil } from "../executives/council.js";
import { dispatchSkynetWorker } from "../workers/skynet.js";
import { forgeSkynetWorker } from "../workers/factory.js";

export async function startCoordinator(task: string) {
  console.log(`[Skynet] Coordinator analyzing task: ${task}`);
  
  // Decide if task is high risk and needs council approval
  if (task.includes("DEPLOY") || task.includes("DELETE") || task.includes("HIGH_RISK")) {
    const approved = await conveneCouncil(task);
    if (!approved) {
      console.log(`[Skynet] Coordinator: Task rejected by Triad Council. Aborting.`);
      return;
    }
  }

  console.log(`[Skynet] Coordinator decomposing work and forging specialized Skynet units...`);
  
  // Dynamically generate a worker tailored to the specific task
  const specializedWorker = await forgeSkynetWorker(task);
  
  // Dispatch the dynamically minted specialist
  await dispatchSkynetWorker(specializedWorker.role, task);
}
