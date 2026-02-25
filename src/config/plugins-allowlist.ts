import type { SkynetConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: SkynetConfig, pluginId: string): SkynetConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
