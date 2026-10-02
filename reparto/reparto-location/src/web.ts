import type {
  RepartoLocationPlugin,
  SharingStatus,
  StartSharingOptions,
} from "./definitions";

export class RepartoLocationWeb implements RepartoLocationPlugin {
  async startSharing(_opts: StartSharingOptions): Promise<void> {
    console.warn("[RepartoLocation] no disponible en web (solo Android)");
  }
  async stopSharing(): Promise<void> {
    /* no-op */
  }
  async status(): Promise<SharingStatus> {
    return { sharing: false, orderId: "", label: "", lastFixAt: 0, locationGranted: false, backgroundGranted: false };
  }
  async requestLocationPermissions(): Promise<SharingStatus> {
    return this.status();
  }
  async requestNotifPermission(): Promise<void> {
    /* no-op */
  }
  async requestBatteryExemption(): Promise<void> {
    /* no-op */
  }
}
