import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const VAULT_ROOT = path.join(os.homedir(), ".skynet", "vault");

export async function initVault() {
  await fs.mkdir(path.join(VAULT_ROOT, "heartbeats"), { recursive: true });
  await fs.mkdir(path.join(VAULT_ROOT, "memory"), { recursive: true });
  await fs.mkdir(path.join(VAULT_ROOT, "inbox"), { recursive: true });
  await fs.mkdir(path.join(VAULT_ROOT, "tasks"), { recursive: true });
}

export async function writeVaultFile(subPath: string, content: string) {
  const fullPath = path.join(VAULT_ROOT, subPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function appendVaultFile(subPath: string, content: string) {
  const fullPath = path.join(VAULT_ROOT, subPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.appendFile(fullPath, content, "utf-8");
}

export async function readVaultFile(subPath: string): Promise<string | null> {
  const fullPath = path.join(VAULT_ROOT, subPath);
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function listVaultDirectory(subPath: string): Promise<string[]> {
  const fullPath = path.join(VAULT_ROOT, subPath);
  try {
    const dirents = await fs.readdir(fullPath, { withFileTypes: true });
    return dirents.map(d => d.name);
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
