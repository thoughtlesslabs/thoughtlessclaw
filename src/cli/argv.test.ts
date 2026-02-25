import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "skynet", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "skynet", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "skynet", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "skynet", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "skynet", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with log-level",
      argv: ["node", "skynet", "--log-level", "debug", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "skynet", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "skynet", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "skynet", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "skynet", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "skynet", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "skynet", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "skynet", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "skynet"],
      expected: null,
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "skynet", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "skynet", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "skynet", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "skynet", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "skynet", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "skynet", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "skynet", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "skynet", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "skynet", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "skynet", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "skynet", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "skynet", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "skynet", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "skynet", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("builds parse argv from raw args", () => {
    const cases = [
      {
        rawArgs: ["node", "skynet", "status"],
        expected: ["node", "skynet", "status"],
      },
      {
        rawArgs: ["node-22", "skynet", "status"],
        expected: ["node-22", "skynet", "status"],
      },
      {
        rawArgs: ["node-22.2.0.exe", "skynet", "status"],
        expected: ["node-22.2.0.exe", "skynet", "status"],
      },
      {
        rawArgs: ["node-22.2", "skynet", "status"],
        expected: ["node-22.2", "skynet", "status"],
      },
      {
        rawArgs: ["node-22.2.exe", "skynet", "status"],
        expected: ["node-22.2.exe", "skynet", "status"],
      },
      {
        rawArgs: ["/usr/bin/node-22.2.0", "skynet", "status"],
        expected: ["/usr/bin/node-22.2.0", "skynet", "status"],
      },
      {
        rawArgs: ["nodejs", "skynet", "status"],
        expected: ["nodejs", "skynet", "status"],
      },
      {
        rawArgs: ["node-dev", "skynet", "status"],
        expected: ["node", "skynet", "node-dev", "skynet", "status"],
      },
      {
        rawArgs: ["skynet", "status"],
        expected: ["node", "skynet", "status"],
      },
      {
        rawArgs: ["bun", "src/entry.ts", "status"],
        expected: ["bun", "src/entry.ts", "status"],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = buildParseArgv({
        programName: "skynet",
        rawArgs: [...testCase.rawArgs],
      });
      expect(parsed).toEqual([...testCase.expected]);
    }
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "skynet",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "skynet", "status"]);
  });

  it("decides when to migrate state", () => {
    const nonMutatingArgv = [
      ["node", "skynet", "status"],
      ["node", "skynet", "health"],
      ["node", "skynet", "sessions"],
      ["node", "skynet", "config", "get", "update"],
      ["node", "skynet", "config", "unset", "update"],
      ["node", "skynet", "models", "list"],
      ["node", "skynet", "models", "status"],
      ["node", "skynet", "memory", "status"],
      ["node", "skynet", "agent", "--message", "hi"],
    ] as const;
    const mutatingArgv = [
      ["node", "skynet", "agents", "list"],
      ["node", "skynet", "message", "send"],
    ] as const;

    for (const argv of nonMutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(false);
    }
    for (const argv of mutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(true);
    }
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});
