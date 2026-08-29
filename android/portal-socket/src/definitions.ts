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
   */
  keepAwake(options?: KeepAwakeOptions): Promise<void>;
}