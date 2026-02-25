import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "skynet",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "skynet", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "skynet", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "skynet", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "skynet", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "skynet", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "skynet", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "skynet", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "skynet", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".skynet-dev");
    expect(env.SKYNET_PROFILE).toBe("dev");
    expect(env.SKYNET_STATE_DIR).toBe(expectedStateDir);
    expect(env.SKYNET_CONFIG_PATH).toBe(path.join(expectedStateDir, "skynet.json"));
    expect(env.SKYNET_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      SKYNET_STATE_DIR: "/custom",
      SKYNET_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.SKYNET_STATE_DIR).toBe("/custom");
    expect(env.SKYNET_GATEWAY_PORT).toBe("19099");
    expect(env.SKYNET_CONFIG_PATH).toBe(path.join("/custom", "skynet.json"));
  });

  it("uses SKYNET_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      SKYNET_HOME: "/srv/skynet-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/skynet-home");
    expect(env.SKYNET_STATE_DIR).toBe(path.join(resolvedHome, ".skynet-work"));
    expect(env.SKYNET_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".skynet-work", "skynet.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "skynet doctor --fix",
      env: {},
      expected: "skynet doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "skynet doctor --fix",
      env: { SKYNET_PROFILE: "default" },
      expected: "skynet doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "skynet doctor --fix",
      env: { SKYNET_PROFILE: "Default" },
      expected: "skynet doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "skynet doctor --fix",
      env: { SKYNET_PROFILE: "bad profile" },
      expected: "skynet doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "skynet --profile work doctor --fix",
      env: { SKYNET_PROFILE: "work" },
      expected: "skynet --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "skynet --dev doctor",
      env: { SKYNET_PROFILE: "dev" },
      expected: "skynet --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("skynet doctor --fix", { SKYNET_PROFILE: "work" })).toBe(
      "skynet --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("skynet doctor --fix", { SKYNET_PROFILE: "  jbskynet  " })).toBe(
      "skynet --profile jbskynet doctor --fix",
    );
  });

  it("handles command with no args after skynet", () => {
    expect(formatCliCommand("skynet", { SKYNET_PROFILE: "test" })).toBe(
      "skynet --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm skynet doctor", { SKYNET_PROFILE: "work" })).toBe(
      "pnpm skynet --profile work doctor",
    );
  });
});
