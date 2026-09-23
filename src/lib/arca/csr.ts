/**
 * Generación de clave privada + CSR (PKCS#10) para certificados ARCA.
 *
 * El comercio ya no necesita OpenSSL ni terminal: el portal genera el par,
 * guarda la clave CIFRADA y le muestra el CSR para pegar en WSASS
 * (homologación) o Administración de Certificados (producción).
 * Cuando ARCA emite el `.crt`, el comercio sube solo ese archivo.
 */
import forge from "node-forge";

export type CsrInput = {
  /** CUIT del comercio, 11 dígitos sin guiones. */
  cuit: string;
  /** Organización (nombre del comercio). */
  org: string;
  /** Sistema cliente (default: Portal659). */
  system?: string;
};

export function generateKeyAndCsr(input: CsrInput): { keyPem: string; csrPem: string } {
  const cuit = (input.cuit || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw new Error("CUIT inválido (11 dígitos)");
  const org = (input.org || "").trim().slice(0, 64);
  if (!org) throw new Error("Indicá el nombre del comercio");
  const system = (input.system || "Portal659").trim().slice(0, 64) || "Portal659";

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { shortName: "C", value: "AR" },
    { shortName: "O", value: org },
    { shortName: "CN", value: system },
    // node-forge no mapea shortName "serialNumber" (lanza "Attribute type
    // not specified"): se usa el OID X.520 explícito 2.5.4.5.
    { type: "2.5.4.5", value: `CUIT ${cuit}` },
  ]);
  csr.sign(keys.privateKey);

  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  };
}
