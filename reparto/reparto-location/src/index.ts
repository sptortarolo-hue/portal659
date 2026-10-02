import { registerPlugin } from "@capacitor/core";

import type { RepartoLocationPlugin } from "./definitions";

const RepartoLocation = registerPlugin<RepartoLocationPlugin>("RepartoLocation", {
  web: () => import("./web").then((m) => new m.RepartoLocationWeb()),
});

export * from "./definitions";
export { RepartoLocation };
