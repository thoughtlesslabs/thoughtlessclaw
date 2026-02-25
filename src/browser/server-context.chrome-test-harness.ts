import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/skynet" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchSkynetChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveSkynetUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopSkynetChrome: vi.fn(async () => {}),
}));
