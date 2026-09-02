import type {
  DiscoverOptions,
  DiscoverResult,
  KeepAwakeOptions,
  PortalSocketPlugin,
  PrintOptions,
  PrintResult,
} from "./definitions";

export class PortalSocketWeb implements PortalSocketPlugin {
  async print(_opts: PrintOptions): Promise<PrintResult> {
    console.warn("[PortalSocket] no disponible en web (solo Android)");
    return { bytes: 0 };
  }
  async discover(_opts?: DiscoverOptions): Promise<DiscoverResult> {
    return { hosts: [] };
  }
  async keepAwake(_opts?: KeepAwakeOptions): Promise<void> {
    /* no-op */
  }
  async requestNotifPermission(): Promise<void> {
    /* no-op */
  }
  async requestBatteryExemption(): Promise<void> {
    /* no-op */
  }
}