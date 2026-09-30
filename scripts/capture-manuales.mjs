// Script de capturas automáticas para los manuales de Portal 659.
//
// Uso:
//   npm run dev                    (en otra terminal)
//   node scripts/seed.mjs          (si la DB está vacía)
//   node scripts/capture-manuales.mjs
//
// Captura pantallas en 2 viewports (móvil + desktop), optimiza con sharp
// y guarda en public/manuales/capturas/.

import { chromium } from "@playwright/test";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "manuales", "capturas");

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const EMAIL = "vendedor1@test.com";
const PASSWORD = "test123456";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

// [slug, path, description]
const SCREENSHOTS = [
  // Alta del comercio
  ["alta-home", "/", "Home de Portal 659"],
  ["alta-login", "/login", "Página de login"],
  ["alta-register", "/register", "Página de registro"],
  ["alta-dashboard", "/vendor/dashboard", "Dashboard - pestaña Pedidos"],
  ["alta-config-perfil", "/vendor/dashboard?seccion=perfil", "Configuración - Perfil"],
  ["alta-config-ubicacion", "/vendor/dashboard?seccion=ubicacion", "Configuración - Ubicación"],
  ["alta-config-pagos", "/vendor/dashboard?seccion=pagos", "Configuración - Pagos"],
  ["alta-micrositio", "/tienda/las-empanadas-de-maria", "Micrositio del comercio"],

  // Recepción de pedidos
  ["recepcion-pedidos", "/vendor/dashboard", "Panel de pedidos"],
  ["recepcion-comanda", "/vendor/dashboard", "Comanda KDS"],

  // Mostrador
  ["mostrador-grid", "/vendor/dashboard", "Mostrador - grilla de productos"],

  // Mesas
  ["mesas-grid", "/vendor/dashboard", "Mesas - grilla"],

  // Impresora
  ["impresora-config", "/vendor/dashboard?seccion=impresora", "Configuración de impresora"],

  // Alertas
  ["alertas-config", "/vendor/dashboard?seccion=alertas", "Configuración de alertas"],
];

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function optimizeImage(tempPath, finalPath) {
  const img = sharp(tempPath);
  const metadata = await img.metadata();
  const targetWidth = 800;
  if (metadata.width > targetWidth) {
    img.resize(targetWidth);
  }
  await img.jpeg({ quality: 85 }).toFile(finalPath);
  fs.unlinkSync(tempPath);
}

async function main() {
  ensureDir(OUT_DIR);

  console.log("Iniciando capturas de manuales...\n");
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Base: ${BASE}`);
  console.log(`Viewports: ${VIEWPORTS.map((v) => v.name).join(", ")}`);
  console.log(`Pantallas: ${SCREENSHOTS.length}\n`);

  const browser = await chromium.launch({ headless: true });

  // Login una sola vez
  console.log("Haciendo login...");
  const loginContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const loginPage = await loginContext.newPage();
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });

  // Cerrar onboarding si existe (aparece antes del login)
  try {
    const saltarBtn = loginPage.locator('button:has-text("Saltar")');
    if (await saltarBtn.isVisible({ timeout: 3000 })) {
      await saltarBtn.click();
      await loginPage.waitForTimeout(500);
    }
  } catch {
    /* no hay onboarding */
  }

  await loginPage.fill("#email", EMAIL);
  await loginPage.fill("#password", PASSWORD);
  await loginPage.click('button[type="submit"]');
  await loginPage.waitForURL("**/vendor/dashboard**", { timeout: 15000 });
  await loginPage.waitForTimeout(2000);
  console.log("Login OK\n");

  // Capturar cada pantalla
  for (const [slug, urlPath, description] of SCREENSHOTS) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      try {
        await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        const tempPath = path.join(OUT_DIR, `${slug}-${viewport.name}.tmp.jpg`);
        const finalPath = path.join(OUT_DIR, `${slug}-${viewport.name}.jpg`);

        await page.screenshot({ path: tempPath, fullPage: false });
        await optimizeImage(tempPath, finalPath);

        console.log(`OK ${slug}-${viewport.name}.jpg (${description})`);
      } catch (e) {
        console.error(`ERROR ${slug} (${viewport.name}): ${e.message}`);
      } finally {
        await context.close();
      }
    }
  }

  await loginContext.close();
  await browser.close();
  console.log("\nCapturas completadas!");
  console.log(`Total: ${SCREENSHOTS.length * VIEWPORTS.length} imagenes`);
}

main().catch(console.error);
