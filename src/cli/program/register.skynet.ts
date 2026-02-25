import type { Command } from "commander";
import process from "node:process";
import { wakeUp } from "../../skynet/vault/wakeup.js";

export function registerSkynetCommands(program: Command) {
  const skynet = program.command("skynet").description("Skynet autonomous architecture commands");

  skynet
    .command("wake")
    .description("Initialize the Vault-First Immortal Brain and wake up the skynet")
    .action(async () => {
      try {
        await wakeUp();
        process.exit(0);
      } catch (e: any) {
        console.error("Skynet Critical Failure:", e);
        process.exit(1);
      }
    });
}
