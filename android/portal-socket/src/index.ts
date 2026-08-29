import { registerPlugin } from "@capacitor/core";

import type { PortalSocketPlugin } from "./definitions";

const PortalSocket = registerPlugin<PortalSocketPlugin>("PortalSocket", {
  web: () => import("./web").then((m) => new m.PortalSocketWeb()),
});

export * from "./definitions";
export { PortalSocket };