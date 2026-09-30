// Script de capturas automáticas para los manuales de Portal 659.
//
// Uso:
//   npm run dev                    (en otra terminal)
//   node scripts/seed.mjs          (si la DB está vacía)
//   node scripts/capture-manuales.mjs

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

// [slug, url, description]
const SCREENSHOTS = [
  ["alta-home", "/", "Home de Portal 659"],
  ["alta-login", "/login", "Página de login"],
  ["alta-register", "/register", "Página de registro"],
  ["alta-dashboard", "/vendor/dashboard", "Dashboard - pestaña Pedidos"],
  ["alta-micrositio", "/tienda/las-empanadas-de-maria", "Micrositio del comercio"],
  ["alta-config", "/vendor/dashboard?seccion=perfil", "Configuración"],
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

async function capturePage(page, slug, viewport, description) {
  const tempPath = path.join(OUT_DIR, `${slug}-${viewport.name}.tmp.jpg`);
  const finalPath = path.join(OUT_DIR, `${slug}-${viewport.name}.jpg`);

  await page.screenshot({ path: tempPath, fullPage: false });
  await optimizeImage(tempPath, finalPath);
  const size = fs.statSync(finalPath).size;
  console.log(`OK ${slug}-${viewport.name}.jpg (${size} bytes) - ${description}`);
}

async function dismissOnboarding(page) {
  await page.evaluate(() => {
    localStorage.setItem("portal659_onboarded", "1");
  });
}

async function main() {
  ensureDir(OUT_DIR);

  console.log("Iniciando capturas de manuales...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Desactivar onboarding permanentemente en este context
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await dismissOnboarding(page);

  // Login
  console.log("Haciendo login...");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });

  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/vendor/dashboard**", { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log("Login OK\n");

  // Capturar cada pantalla
  for (const [slug, urlPath, description] of SCREENSHOTS) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      try {
        await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);
        await capturePage(page, slug, viewport, description);
      } catch (e) {
        console.error(`ERROR ${slug} (${viewport.name}): ${e.message}`);
      }
    }
  }

  await context.close();
  await browser.close();
  console.log("\nCapturas completadas!");
}

main().catch(console.error);
