import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createSkynet } from "../skynet/index.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";

type AgentsAddOptions = {
  name?: string;
  description?: string;
  vault?: string;
  nonInteractive?: boolean;
  json?: boolean;
};

/**
 * `skynet agents add <name>` — Provisions a new Project Manager in the Vault.
 *
 * This replaces the legacy workspace-based agent provisioning. Instead of
 * creating a separate workspace directory and config entry, this command
 * creates a full project + project manager inside the Vault hierarchy:
 *
 *   ~/.skynet/vault/projects/<name>/
 *     ├── project.json
 *     ├── manager.json
 *     ├── tasks/
 *     ├── memories/
 *     └── workers/
 */
export async function agentsAddCommand(
  opts: AgentsAddOptions,
  runtime: RuntimeEnv = defaultRuntime,
  params?: { hasFlags?: boolean },
) {
  const vaultPath = opts.vault?.trim() || "~/.skynet/vault";
  const nameInput = opts.name?.trim();
  const descriptionInput = opts.description?.trim() || "";
  const hasFlags = params?.hasFlags === true;
  const nonInteractive = Boolean(opts.nonInteractive || hasFlags);

  if (nonInteractive) {
    if (!nameInput) {
      runtime.error("Project name is required. Usage: skynet agents add --name <name>");
      runtime.exit(1);
      return;
    }

    await provisionProject({
      name: nameInput,
      description: descriptionInput,
      vaultPath,
      json: Boolean(opts.json),
      runtime,
    });
    return;
  }

  // Interactive wizard
  const prompter = createClackPrompter();
  try {
    await prompter.intro("Hire a new Project Manager");

    const name =
      nameInput ??
      (await prompter.text({
        message: "Project name",
        validate: (value) => {
          if (!value?.trim()) {
            return "Required";
          }
          if (/[^a-zA-Z0-9_-]/.test(value.trim())) {
            return "Only letters, numbers, hyphens, and underscores allowed.";
          }
          return undefined;
        },
      }));

    const projectName = String(name ?? "")
      .trim()
      .toLowerCase();

    const description = await prompter.text({
      message: "Project description (optional)",
      initialValue: descriptionInput,
    });

    await provisionProject({
      name: projectName,
      description: String(description ?? "").trim(),
      vaultPath,
      json: Boolean(opts.json),
      runtime,
    });

    await prompter.outro(`Project manager "${projectName}" hired and ready.`);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.exit(1);
      return;
    }
    throw err;
  }
}

async function provisionProject(params: {
  name: string;
  description: string;
  vaultPath: string;
  json: boolean;
  runtime: RuntimeEnv;
}): Promise<void> {
  const { name, description, vaultPath, json, runtime } = params;

  const skynetSys = createSkynet({ vaultPath });
  await skynetSys.initialize();

  // Check if project already exists
  const existingProject = await skynetSys.getVault().getProject(name);
  if (existingProject) {
    runtime.error(`Project "${name}" already exists.`);
    runtime.exit(1);
    return;
  }

  const manager = await skynetSys.hireProjectManager(name, description || undefined);

  const payload = {
    projectName: name,
    managerId: manager.getManagerId(),
    description: description || null,
    vaultPath,
  };

  if (json) {
    runtime.log(JSON.stringify(payload, null, 2));
  } else {
    runtime.log(`✅ Project manager hired for: ${name}`);
    runtime.log(`   Manager ID: ${manager.getManagerId()}`);
    runtime.log(`   Vault: ${vaultPath}/projects/${name}/`);
    if (description) {
      runtime.log(`   Description: ${description}`);
    }
  }
}
