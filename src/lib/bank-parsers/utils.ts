// Parsea montos en formato argentino: "15.000,00", "15000.00", "$ 15.000", "15.000"
export function parseAmount(raw: string): number {
  let cleaned = raw.replace(/[^0-9.,]/g, "").trim();
  // Si tiene coma y punto, el punto es miles y la coma es decimal
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    // Solo coma: puede ser decimal (15,50) o miles (15,000)
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

// Normaliza nombre: sin tildes, lowercase, trim
export function normalizeName(name: string | null): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extrae nombre del remitente de texto libre
export function extractSender(text: string): string | null {
  const patterns = [
    /(?:de|remitente|origen|enviado por|transferencia de)[:\s]+([A-Za-záéíóúñÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ\s]{2,40}?)(?:\.|$|\n|,|;)/i,
    /transferencia.*?de\s+([A-Za-záéíóúñÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ\s]{2,40}?)(?:\.|$|\n|,|;)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const name = m[1].trim();
      if (name.length >= 3 && name.length <= 50) return name;
    }
  }
  return null;
}

// Extrae operation_id de texto
export function extractOperationId(text: string): string | null {
  const patterns = [
    /operaci[oó]n\s*N?[°º]?\s*(\d{4,20})/i,
    /n[uú]mero\s*de\s*operaci[oó]n[:\s]*(\d{4,20})/i,
    /id[:\s]*(\d{6,20})/i,
    /referencia[:\s]*(\d{4,20})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}