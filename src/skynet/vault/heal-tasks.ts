#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function run() {
  // Check if path was passed in, otherwise default to ~/.skynet/vault
  const args = process.argv.slice(2);
  let vaultPath = path.resolve(os.homedir(), ".skynet/vault");
  if (args[0]) {
    vaultPath = path.resolve(process.cwd(), args[0]);
  }

  console.log(`Scanning vault at ${vaultPath}...`);

  try {
    const tasksDir = path.join(vaultPath, "tasks");
    const tasks = await fs.readdir(tasksDir);
    let resetCount = 0;

    for (const t of tasks) {
      if (!t.endsWith(".json")) {
        continue;
      }

      const taskPath = path.join(tasksDir, t);
      const data = JSON.parse(await fs.readFile(taskPath, "utf-8"));

      if (data.status === "in_progress") {
        data.status = "pending";
        // Attempt to heal missing assignee if we can
        const projectName = data.metadata?.projectName;
        if (projectName) {
          data.assignee = `manager-${projectName}`;
        }
        await fs.writeFile(taskPath, JSON.stringify(data, null, 2));
        resetCount++;
        console.log(`Reset task ${t} back to pending`);
      } else if (data.status === "pending" && !data.assignee && data.metadata?.projectName) {
        // Fix pending tasks missing assignee
        data.assignee = `manager-${data.metadata.projectName}`;
        await fs.writeFile(taskPath, JSON.stringify(data, null, 2));
        console.log(`Healed assignee on pending task ${t}`);
      }
    }

    console.log(`Done. Reset ${resetCount} orphaned tasks.`);
  } catch (err) {
    console.error("Error cleaning tasks:", err);
  }
}

run().catch(console.error);
