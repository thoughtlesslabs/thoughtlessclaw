#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function run() {
  const args = process.argv.slice(2);
  let vaultPath = path.resolve(os.homedir(), ".skynet/vault");
  if (args[0]) {
    vaultPath = path.resolve(process.cwd(), args[0]);
  }

  const skynetPath = path.resolve(vaultPath, "..");
  const skynetJsonPath = path.join(skynetPath, "skynet.json");

  console.log(`Starting Skynet Cleanup Protocol...`);
  console.log(`Target Skynet Directory: ${skynetPath}`);
  console.log(`Target Vault Directory: ${vaultPath}`);

  // 1. Clean skynet.json
  try {
    const configData = JSON.parse(await fs.readFile(skynetJsonPath, "utf-8"));
    let configChanged = false;

    if (configData.agents && Array.isArray(configData.agents.list)) {
      const originalLen = configData.agents.list.length;
      configData.agents.list = configData.agents.list.filter((a: unknown) => {
        const agent = a as { id?: string };
        return !agent.id?.startsWith("worker-") && !agent.id?.startsWith("worker:");
      });
      if (configData.agents.list.length !== originalLen) {
        configChanged = true;
        console.log(
          `Cleaned ${originalLen - configData.agents.list.length} worker entries from skynet.json agents.list`,
        );
      }

      // Clean allowAgents inside main - Only remove the legacy worker-* formats. Keep worker:
      const mainAgent = configData.agents.list.find(
        (a: unknown) => (a as { id?: string }).id === "main",
      ) as { id: string; subagents?: { allowAgents?: string[] } } | undefined;

      if (mainAgent?.subagents?.allowAgents) {
        const allowLen = mainAgent.subagents.allowAgents.length;
        mainAgent.subagents.allowAgents = mainAgent.subagents.allowAgents.filter(
          (id: string) => !id.startsWith("worker-"),
        );
        if (mainAgent.subagents.allowAgents.length !== allowLen) {
          configChanged = true;
          console.log(
            `Cleaned ${allowLen - mainAgent.subagents.allowAgents.length} legacy worker-* entries from main allowAgents`,
          );
        }
      }
    }

    if (configChanged) {
      await fs.writeFile(skynetJsonPath, JSON.stringify(configData, null, 2));
      console.log(`Successfully saved cleaned skynet.json`);
    } else {
      console.log(`skynet.json looks clean, no legacy worker entries found.`);
    }
  } catch (err) {
    console.warn(`Could not process skynet.json (might not exist):`, err);
  }

  // 2. Clean Vault Agent Directories
  try {
    const agentsDir = path.join(vaultPath, "agents");
    const agentDirs = await fs.readdir(agentsDir);
    let deletedWorkers = 0;
    for (const d of agentDirs) {
      if (d.startsWith("worker-") || d.startsWith("worker:")) {
        await fs.rm(path.join(agentsDir, d), { recursive: true, force: true });
        deletedWorkers++;
      }
    }
    console.log(`Deleted ${deletedWorkers} orphaned worker agent directories.`);
  } catch (err) {
    console.warn(`Could not process vault/agents:`, err);
  }

  // 2.5 Clean Virtual Worker Directories
  try {
    const projectsDir = path.join(vaultPath, "projects");
    const projects = await fs.readdir(projectsDir).catch(() => []);
    let deletedVirtualWorkers = 0;

    for (const proj of projects) {
      const workersDir = path.join(projectsDir, proj, "workers");
      const workers = await fs.readdir(workersDir).catch(() => []);
      for (const w of workers) {
        await fs.rm(path.join(workersDir, w), { recursive: true, force: true });
        deletedVirtualWorkers++;
      }

      // Re-sync manager states
      const managerJsonPath = path.join(projectsDir, proj, "manager.json");
      try {
        const managerData = JSON.parse(await fs.readFile(managerJsonPath, "utf-8"));
        let mgrChanged = false;
        if (
          managerData &&
          Array.isArray(managerData.activeWorkers) &&
          managerData.activeWorkers.length > 0
        ) {
          managerData.activeWorkers = [];
          mgrChanged = true;
        }
        if (managerData && managerData.currentTaskId) {
          managerData.currentTaskId = null;
          mgrChanged = true;
        }
        if (mgrChanged) {
          await fs.writeFile(managerJsonPath, JSON.stringify(managerData, null, 2));
        }
      } catch {
        // Ignore if manager.json doesn't exist
      }
    }
    console.log(
      `Deleted ${deletedVirtualWorkers} ephemeral virtual worker directories and reset project manager states.`,
    );
  } catch (err) {
    console.warn(`Could not process vault/projects:`, err);
  }

  // 3. Clean Accidentally Nested Vault Paths
  try {
    const nestedVaultPath = path.join(vaultPath, "agents/manager-system/home");
    const stat = await fs.stat(nestedVaultPath).catch(() => null);
    if (stat) {
      await fs.rm(nestedVaultPath, { recursive: true, force: true });
      console.log(`Deleted accidentally nested vault path at ${nestedVaultPath}`);
    }
  } catch {
    // Ignore as it usually means it doesn't exist
  }

  // 4. Heal Tasks
  try {
    const tasksDir = path.join(vaultPath, "tasks");
    const tasks = await fs.readdir(tasksDir).catch(() => []);
    let resetCount = 0;
    let healedCount = 0;

    for (const t of tasks) {
      if (!t.endsWith(".json")) {
        continue;
      }

      const taskPath = path.join(tasksDir, t);
      const data = JSON.parse(await fs.readFile(taskPath, "utf-8"));
      let changed = false;

      // Unstick in_progress tasks
      if (data.status === "in_progress") {
        data.status = "pending";
        changed = true;
        resetCount++;
      }

      // Ensure pending tasks hit the right manager
      if (data.status === "pending" && (!data.assignee || data.assignee === "")) {
        const projectName = data.metadata?.projectName;
        if (projectName) {
          data.assignee = `manager-${projectName}`;
          changed = true;
          healedCount++;
        }
      }

      if (changed) {
        await fs.writeFile(taskPath, JSON.stringify(data, null, 2));
      }
    }

    console.log(
      `Task Healing Complete. Reset ${resetCount} stuck tasks to pending. Bound ${healedCount} unassigned tasks to their project managers.`,
    );
  } catch (err) {
    console.error("Error healing tasks:", err);
  }
  // 5. Clean Transcripts (Remove empty text blocks that crash Anthropic)
  try {
    const agentsDir = path.join(vaultPath, "agents");
    const agentDirs = await fs.readdir(agentsDir).catch(() => []);
    let sanitizedCount = 0;

    for (const d of agentDirs) {
      const sessionsDir = path.join(agentsDir, d, "sessions");
      const sessions = await fs.readdir(sessionsDir).catch(() => []);
      for (const s of sessions) {
        if (!s.endsWith(".jsonl")) {
          continue;
        }
        const filePath = path.join(sessionsDir, s);

        let fileContent = await fs.readFile(filePath, "utf-8");
        const lines = fileContent.split(/\r?\n/);
        let changed = false;

        const newLines = lines.map((line) => {
          if (!line.trim()) {
            return line;
          }
          try {
            const parsed = JSON.parse(line);
            if (parsed?.message?.content && Array.isArray(parsed.message.content)) {
              let contentChanged = false;
              const newContent = parsed.message.content.map(
                (block: { type?: string; text?: unknown }) => {
                  if (
                    block.type === "text" &&
                    typeof block.text === "string" &&
                    block.text.trim() === ""
                  ) {
                    contentChanged = true;
                    return { ...block, text: "[empty text fixed]" };
                  }
                  return block;
                },
              );

              if (contentChanged) {
                changed = true;
                parsed.message.content = newContent;
                return JSON.stringify(parsed);
              }
            }
          } catch {
            // ignore bad lines
          }
          return line;
        });

        if (changed) {
          await fs.writeFile(filePath, newLines.join("\n"));
          sanitizedCount++;
        }
      }
    }
    console.log(`Cleaned ${sanitizedCount} transcript files containing empty text blocks.`);
  } catch (err) {
    console.warn(`Could not process transcripts:`, err);
  }
}

run().catch(console.error);
