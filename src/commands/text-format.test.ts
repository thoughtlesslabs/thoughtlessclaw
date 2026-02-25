import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("skynet", 16)).toBe("skynet");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("skynet-status-output", 10)).toBe("skynet-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
