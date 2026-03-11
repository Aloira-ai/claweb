import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { clawebPlugin } from "./src/channel.js";

const plugin = {
  id: "claweb",
  name: "CLAWeb",
  description: "OpenClaw Web Channel plugin (MVP-0 text loop)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: clawebPlugin(api.runtime) });
  },
};

export default plugin;
