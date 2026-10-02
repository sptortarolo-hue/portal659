export interface StartSharingOptions {
  orderId: string;
  /** JWT del repartidor (session.access_token del login) → header Bearer. */
  token: string;
  serverUrl: string;
  /** Etiqueta para la notificación (ej: "Pedido Nro. 12 · Juan"). */
  label: string;
}

export interface SharingStatus {
  sharing: boolean;
  orderId: string;
  label: string;
  /** ms epoch del último POST exitoso (0 si nunca). */
  lastFixAt: number;
  locationGranted: boolean;
  backgroundGranted: boolean;
}

export interface RepartoLocationPlugin {
  /**
   * Inicia el foreground service de ubicación para un pedido: reporta
   * lat/lng cada ~15s (o 20m) a POST /api/vendor/orders/[id]/position.
   * Sobrevive con la pantalla apagada. El server (409/403/404) lo detiene
   * solo cuando el pedido deja de estar En camino.
   */
  startSharing(options: StartSharingOptions): Promise<void>;
  /** Detiene el servicio y borra el pedido persistido. */
  stopSharing(): Promise<void>;
  /** Estado actual (para pintar Iniciar/Detener y "último envío hace Xs"). */
  status(): Promise<SharingStatus>;
  /**
   * Pide permisos de ubicación en el orden que exige Android: primero
   * FINE+COARSE, y en la siguiente llamada (con FINE ya dado) el
   * BACKGROUND (Android 10+). Llamar hasta que backgroundGranted sea true.
   */
  requestLocationPermissions(): Promise<SharingStatus>;
  /** Pide POST_NOTIFICATIONS (Android 13+) para la notificación fija. */
  requestNotifPermission(): Promise<void>;
  /** Abre el diálogo de exención de optimización de batería. */
  requestBatteryExemption(): Promise<void>;
}
