export interface PrintOptions {
  ip: string;
  port?: number;
  dataBase64: string;
}

export interface PrintResult {
  bytes: number;
}

export interface DiscoverOptions {
  port?: number;
  timeoutMs?: number;
}

export interface DiscoverResult {
  hosts: string[];
}

export interface KeepAwakeOptions {
  enabled?: boolean;
}

export interface PortalSocketPlugin {
  /**
   * Envía bytes ESC/POS crudos (base64) a una impresora por TCP.
   */
  print(options: PrintOptions): Promise<PrintResult>;
  /**
   * Escanea la red local (subred /24) buscando hosts que acepten el puerto dado.
   */
  discover(options?: DiscoverOptions): Promise<DiscoverResult>;
  /**
   * Mantiene la pantalla encendida mientras la app esté en primer plano.
   * También levanta (o baja) el foreground service que evita que Android mate el proceso.
   */
  keepAwake(options?: KeepAwakeOptions): Promise<void>;

  /** Pide el permiso POST_NOTIFICATIONS (Android 13+) para mostrar la notificación fija. */
  requestNotifPermission(): Promise<void>;

  /**
   * Activa o desativa completamente la app: cierra el WS, suelta la pantalla
   * y detiene el foreground service. El persistido como usuario hace que al
   * reiniciar el celular, el servicio solo arranque si está activo (enabled=true).
   */
  setActive(options: { active: boolean }): Promise<void>;

  /** Devuelve si el modo "activo" está habilitado (persistida). */
  isEnabled(): Promise<{ enabled: boolean }>;

  /** Guarda config nativa (serverUrl/token/printerIp/printerPort) y arranca el servicio. */
  saveConfig(options: {
    serverUrl: string;
    token: string;
    printerIp: string;
    printerPort: number;
  }): Promise<void>;

  /** Estado actual del servicio (enabled + estado de conexión). */
  status(): Promise<{ enabled: boolean; conn: string }>;
}

export interface SaveConfigOptions {
  serverUrl: string;
  token: string;
  printerIp: string;
  printerPort: number;
}