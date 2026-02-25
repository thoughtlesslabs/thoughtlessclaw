import type {
  AnyAgentTool,
  SkynetPluginApi,
  SkynetPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: SkynetPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as SkynetPluginToolFactory,
    { optional: true },
  );
}
