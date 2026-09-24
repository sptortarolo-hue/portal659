/**
 * Traduce los faults de ARCA a guía accionable en español.
 * Los mensajes crudos (faultstring) son técnicos; el `hint` le dice al
 * comercio qué hacer. Devuelve null si no hay traducción conocida.
 */
export function explainArcaFault(message: string): string | null {
  const m = (message || "").toLowerCase();

  if (m.includes("ac de confianza") || m.includes("authority") || m.includes("issuer")) {
    return "Ese certificado no es de este entorno: en Prueba usá el .crt emitido por WSASS; en Producción, el de Administración de Certificados (o invertí el entorno arriba).";
  }
  if (m.includes("alreadyauthenticated")) {
    return "Login duplicado en curso en ARCA: esperá unos segundos y reintentá.";
  }
  if (m.includes("ya posee") || (m.includes("posee") && m.includes("ta "))) {
    return "ARCA indica que ya hay un ticket válido vigente (login reciente, reinicio del portal u otro sistema con el mismo CUIT): no emite otro hasta su vencimiento (máx. 12 h). Reintentá más tarde; una vez obtenido, el portal lo reutiliza solo.";
  }
  if (m.includes("no respondió en") || m.includes("sin conexión")) {
    return "ARCA está lento o caído (homo se cae seguido): reintentá en unos minutos. El cobro ya quedó registrado, la factura se puede emitir después sin duplicar.";
  }
  if (
    m.includes("no autorizado") ||
    m.includes("not authorized") ||
    m.includes("asociad") ||
    m.includes("autorizaci")
  ) {
    return "El certificado no está asociado al servicio de Factura Electrónica (wsfe): asocialo en WSASS (prueba) o en Administrador de Relaciones (producción).";
  }
  if (m.includes("vencido") || m.includes("expir") || m.includes("vigencia")) {
    return "El certificado está vencido o fuera de vigencia: generá un CSR nuevo en el portal y pedí otro certificado en ARCA.";
  }
  if (m.includes("cms") || m.includes("firma") || m.includes("signature")) {
    return "ARCA rechazó la firma: el .crt no corresponde a la clave guardada. Regenerá el CSR en el portal y repetí el trámite.";
  }
  if (m.includes("cuit") && (m.includes("represent") || m.includes("dn"))) {
    return "El CUIT del certificado no coincide con el cargado: revisá que el CSR se haya generado con el CUIT del comercio.";
  }
  return null;
}
