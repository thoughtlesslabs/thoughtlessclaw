import process from "node:process";
import type { Command } from "commander";
import { createSkynet, createInboxServer } from "../skynet/index.js";
import { wakeUp } from "../skynet/vault/wakeup.js";
import { registerConfigCli } from "./config-cli.js";

const skynetCommandDefinitions = [
  {
    name: "start",
    description: "Start the Skynet daemon",
    options: [
      { flags: "-p, --port <port>", default: "18790", desc: "API port" },
      { flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" },
    ],
    handler: async (opts: Record<string, unknown>) => {
      const port = parseInt(opts.port as string);

      const skynetSys = createSkynet({
        vaultPath: opts.vault as string,
        heartbeatIntervalMs: 60000,
        idleSleepThresholdMs: 300000,
      });

      await skynetSys.initialize();

      // Run Inbox server on an offset port to avoid EADDRINUSE conflict with Gateway
      const inboxPort = port + 1;
      const inboxServer = createInboxServer(skynetSys, { port: inboxPort });
      await inboxServer.start();

      await skynetSys.start();

      // Boot the gateway server on the same port.
      // The gateway handles Telegram, Discord, and other channel WebSocket
      // connections. Without it, no chat messages would reach the agent.
      const { startGatewayServer } = await import("../gateway/server.js");
      const gatewayServer = await startGatewayServer(port);

      console.log(`[Skynet] Running at http://localhost:${port}`);
      console.log("[Skynet] Gateway + Vault + Executives active");
      console.log("Press Ctrl+C to stop");

      // === COLD-START BOOT SEQUENCE ===
      // After gateway initializes, immediately wake main and all three executives.
      // requestHeartbeatNow queues a wake that the heartbeat runner resolves against
      // each agent's configured session key — creating it if needed on first fire.
      setTimeout(async () => {
        try {
          const { requestHeartbeatNow } = await import("../infra/heartbeat-wake.js");
          requestHeartbeatNow({ reason: "action:boot", agentId: "main" });
          requestHeartbeatNow({ reason: "action:boot", agentId: "oversight" });
          requestHeartbeatNow({ reason: "action:boot", agentId: "monitor" });
          requestHeartbeatNow({ reason: "action:boot", agentId: "optimizer" });
          console.log("[Skynet] Boot sequence complete — main and executives woken.");
        } catch (err) {
          console.error("[Skynet Boot] Boot sequence error:", err);
        }
      }, 2000);

      process.on("SIGINT", async () => {
        await skynetSys.stop();
        await inboxServer.stop();
        if (gatewayServer?.close) {
          await gatewayServer.close();
        }
        process.exit(0);
      });
    },
  },
  {
    name: "status",
    description: "Show Skynet status",
    options: [{ flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" }],
    handler: async (opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const executives = skynetSys.getAllExecutives();
      const failover = skynetSys.getFailoverManager();

      console.log("\n=== Skynet Status ===\n");
      console.log("Executives:");
      for (const exec of executives) {
        const state = await exec.getState();
        console.log(`  - ${exec.getRole()}: ${state?.status || "unknown"}`);
      }

      console.log("\nProvider Health:");
      const health = failover.getStatus();
      for (const p of health.providers) {
        console.log(`  - ${p.provider}: ${p.status} (${p.latencyMs}ms latency)`);
      }

      console.log("");
    },
  },
  {
    name: "inbox",
    description: "List inbox items",
    options: [{ flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" }],
    handler: async (opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const vault = skynetSys.getVault();
      const files = await vault.list("inbox", "\\.json$");

      console.log("\n=== Inbox ===\n");
      for (const file of files) {
        const entry = await vault.read(`inbox/${file}`);
        if (entry) {
          const e = entry as unknown as {
            id: string;
            request?: string;
            priority?: string;
            status?: string;
            createdAt: number;
          };
          console.log(
            `[${e.priority || "normal"}] ${e.status || "pending"}: ${e.request?.slice(0, 50)}...`,
          );
          console.log(`  ID: ${e.id}`);
          console.log("");
        }
      }
    },
  },
  {
    name: "task",
    description: "Add a task to the inbox",
    arguments: [{ name: "<request>", desc: "Task request" }],
    options: [
      {
        flags: "-p, --priority <level>",
        default: "normal",
        desc: "Priority (critical|high|normal|low)",
      },
      { flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" },
    ],
    handler: async (request: string, opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const id = await skynetSys.addInboxItem(
        request,
        "",
        "cli",
        opts.priority as "critical" | "high" | "normal" | "low",
      );

      console.log(`Task created: ${id}`);
    },
  },
  {
    name: "vote",
    description: "Show Triad Council votes",
    options: [{ flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" }],
    handler: async (opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const vault = skynetSys.getVault();
      const files = await vault.list("votes", "\\.json$");

      console.log("\n=== Triad Council Votes ===\n");
      for (const file of files) {
        const entry = await vault.read(`votes/${file}`);
        if (entry) {
          const e = entry as unknown as {
            proposal: string;
            status: string;
            votes: { agentId: string; vote: string; reason: string }[];
          };
          console.log(`Proposal: ${e.proposal}`);
          console.log(`Status: ${e.status}`);
          for (const v of e.votes) {
            console.log(`  - ${v.agentId}: ${v.vote} (${v.reason})`);
          }
          console.log("");
        }
      }
    },
  },
  {
    name: "projects",
    description: "List all projects",
    options: [{ flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" }],
    handler: async (opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const projects = await skynetSys.listProjects();

      console.log("\n=== Projects ===\n");
      for (const project of projects) {
        const manager = skynetSys.getProjectManager(project);
        if (manager) {
          const status = manager.getStatus();
          console.log(
            `  - ${project}: ${status.status} (${status.completedTasks}/${status.totalTasks} tasks)`,
          );
        } else {
          console.log(`  - ${project}: system (built-in)`);
        }
      }
      console.log("");
    },
  },
  {
    name: "project:create",
    description: "Hire a new project manager",
    arguments: [{ name: "<name>", desc: "Project name" }],
    options: [
      { flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" },
      { flags: "-d, --description <text>", default: "", desc: "Project description" },
    ],
    handler: async (name: string, opts: Record<string, unknown>) => {
      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const manager = await skynetSys.hireProjectManager(name, opts.description as string);
      console.log(`Project manager hired for: ${name}`);
      console.log(`Manager ID: ${manager.getManagerId()}`);
    },
  },
  {
    name: "init",
    description: "Initialize the Skynet vault and system",
    options: [{ flags: "--vault <path>", default: "~/.skynet/vault", desc: "Vault path" }],
    handler: async (opts: Record<string, unknown>) => {
      console.log("Initializing Skynet vault...");

      const skynetSys = createSkynet({ vaultPath: opts.vault as string });
      await skynetSys.initialize();

      const projects = await skynetSys.listProjects();

      console.log(`\n✅ Skynet initialized successfully!`);
      console.log(`   Vault: ${String(opts.vault)}`);
      console.log(`   Projects: ${projects.join(", ")}`);
      console.log(`\nTo start Skynet, run: skynet start`);
    },
  },
  {
    name: "wake",
    description: "Initialize the Vault-First Immortal Brain and wake up the skynet",
    options: [],
    handler: async () => {
      try {
        await wakeUp();
        process.exit(0);
      } catch (e: unknown) {
        console.error("Skynet Critical Failure:", e);
        process.exit(1);
      }
    },
  },
];

export function registerSkynetCommands(target: Command) {
  for (const cmd of skynetCommandDefinitions) {
    let command = target.command(cmd.name);

    if (cmd.arguments) {
      for (const arg of cmd.arguments) {
        command = command.argument(arg.name, arg.desc);
      }
    }

    command = command.description(cmd.description);

    for (const opt of cmd.options) {
      command = command.option(opt.flags, opt.desc, opt.default);
    }

    command.action(cmd.handler as (...args: unknown[]) => Promise<void>);
  }
}

function registerCommandsOn(target: Command, asRoot = false) {
  for (const cmd of skynetCommandDefinitions) {
    let command = target.command(cmd.name);

    if (cmd.arguments) {
      for (const arg of cmd.arguments) {
        command = command.argument(arg.name, arg.desc);
      }
    }

    command = command.description(cmd.description);

    for (const opt of cmd.options) {
      command = command.option(opt.flags, opt.desc, opt.default);
    }

    command.action(cmd.handler as (...args: unknown[]) => Promise<void>);
  }

  if (!asRoot) {
    registerConfigCli(target);
  }
}

export async function registerSkynetCli(program: Command, asRoot = false) {
  if (asRoot) {
    registerCommandsOn(program, true);
    registerConfigCli(program);
  } else {
    const skynet = program
      .command("skynet")
      .description("Skynet Autonomous OS - Self-sustaining agent workforce")
      .alias("s");

    registerCommandsOn(skynet, false);
  }
}
