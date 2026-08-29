import { randomBytes } from "node:crypto";

export function generatePrintToken(): string {
  return `pp_${randomBytes(20).toString("base64url")}`;
}