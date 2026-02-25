import { appendVaultFile } from "../vault/store.js";

export interface SkynetWorkerProfile {
  role: string;
  systemPrompt: string;
  allowedTools: string[];
}

export async function forgeSkynetWorker(roleDescription: string): Promise<SkynetWorkerProfile> {
  console.log(`[Skynet] Tier 2 Manager requested a new specialized worker for: ${roleDescription}`);
  
  // In a full implementation, the manager uses an LLM schema generation to dynamically 
  // determine the optimal profile. Here we map typical roles to constraints.
  
  let profile: SkynetWorkerProfile = {
    role: "skynet-general",
    systemPrompt: "You are a general Skynet worker.",
    allowedTools: ["read", "write"]
  };

  if (roleDescription.toLowerCase().includes("content") || roleDescription.toLowerCase().includes("writer")) {
     profile = {
       role: "skynet-content-writer",
       systemPrompt: "You are a Skynet Content Writer. Your goal is to draft, edit, and refine text. You must output final drafts prefixing with 'DONE:'.",
       allowedTools: ["read", "write", "web_search", "browser"]
     };
  } else if (roleDescription.toLowerCase().includes("develop") || roleDescription.toLowerCase().includes("code")) {
     profile = {
       role: "skynet-developer",
       systemPrompt: "You are a Skynet Developer. Your goal is to write, test, and patch code. You must prefix completions with 'DONE:'.",
       allowedTools: ["read", "write", "edit", "apply_patch", "exec", "process"]
     };
  } else if (roleDescription.toLowerCase().includes("design")) {
     profile = {
       role: "skynet-graphic-designer",
       systemPrompt: "You are a Skynet Graphic Designer. Generate visual assets and design systems.",
       allowedTools: ["image", "browser", "canvas"]
     };
  }

  console.log(`[Skynet] Worker Forge synthesized new specialized profile: ${profile.role}`);
  
  // Register the new worker profile in the Vault so it persists across Skynet wakeups
  await appendVaultFile("registry/active_workers.json", JSON.stringify(profile) + "\n");
  
  return profile;
}
