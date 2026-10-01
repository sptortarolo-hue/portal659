// Script de capturas automáticas para los manuales de Portal 659.
//
// Uso:
//   npm run dev                    (en otra terminal)
//   node scripts/seed.mjs          (si la DB está vacía)
//   node scripts/capture-manuales.mjs
//
// Navega el dashboard con clicks reales y verificados, capturando cada paso.

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
const DIRECT_URLS = [
  ["alta-home", "/", "Home de Portal 659"],
  ["alta-login", "/login", "Página de login"],
  ["alta-register", "/register", "Página de registro"],
  ["alta-micrositio", "/tienda/las-empanadas-de-maria", "Micrositio del comercio"],
];

// [slug, tabText, description]
const DASHBOARD_TABS = [
  ["alta-dashboard", null, "Dashboard - pestaña Pedidos"],
  ["recepcion-pedidos", null, "Panel de pedidos"],
  ["recepcion-comanda", "Comanda", "Comanda KDS"],
  ["mostrador-grid", "Mostrador", "Mostrador - grilla de productos"],
  ["mesas-grid", "Mesas", "Mesas - grilla"],
];

// [slug, seccion, description]
const CONFIG_SECTIONS = [
  ["alta-config-perfil", "Perfil", "Configuración - Perfil"],
  ["alta-config-ubicacion", "Ubicación y horarios", "Configuración - Ubicación"],
  ["alta-config-pagos", "Pagos y entrega", "Configuración - Pagos"],
  ["impresora-config", "Impresora", "Configuración de impresora"],
  ["alertas-config", "Alertas", "Configuración de alertas"],
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

async function clickAndVerify(page, text, previousSize) {
  if (!text) return true;

  try {
    // Buscar el botón con el texto exacto usando evaluate
    const clicked = await page.evaluate((text) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const btn = buttons.find((b) => {
        const btnText = b.textContent || "";
        return btnText.includes(text) && b.offsetParent !== null;
      });
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, text);

    if (clicked) {
      await page.waitForTimeout(2000);

      // Verificar que la pantalla cambió
      const tempPath = path.join(OUT_DIR, "temp-verify.jpg");
      await page.screenshot({ path: tempPath });
      const newSize = fs.statSync(tempPath).size;
      fs.unlinkSync(tempPath);

      if (newSize !== previousSize) {
        console.log(`  Click "${text}" OK (tamaño: ${previousSize} -> ${newSize})`);
        return true;
      } else {
        console.warn(`  Click "${text}" no cambió la pantalla (mismo tamaño: ${newSize})`);
        return false;
      }
    }
  } catch (e) {
    console.warn(`  No se pudo clickear "${text}": ${e.message}`);
  }
  return false;
}

async function main() {
  ensureDir(OUT_DIR);

  console.log("Iniciando capturas de manuales...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Desactivar onboarding
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("portal659_onboarded", "1");
  });

  // Login
  console.log("Haciendo login...");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/vendor/dashboard**", { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log("Login OK\n");

  // Capturar URLs directas
  for (const [slug, urlPath, description] of DIRECT_URLS) {
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

  // Capturar tabs del dashboard
  for (const [slug, tabText, description] of DASHBOARD_TABS) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      try {
        await page.goto(`${BASE}/vendor/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        // Tamaño actual para comparar
        const tempPath = path.join(OUT_DIR, "temp-verify.jpg");
        await page.screenshot({ path: tempPath });
        const previousSize = fs.statSync(tempPath).size;
        fs.unlinkSync(tempPath);

        await clickAndVerify(page, tabText, previousSize);

        await capturePage(page, slug, viewport, description);
      } catch (e) {
        console.error(`ERROR ${slug} (${viewport.name}): ${e.message}`);
      }
    }
  }

  // Capturar secciones de Configuración
  for (const [slug, seccion, description] of CONFIG_SECTIONS) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      try {
        await page.goto(`${BASE}/vendor/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        const isMobile = viewport.name === "mobile";
        if (isMobile) {
          const tempPath = path.join(OUT_DIR, "temp-verify.jpg");
          await page.screenshot({ path: tempPath });
          const prevSize = fs.statSync(tempPath).size;
          fs.unlinkSync(tempPath);
          await clickAndVerify(page, "Más", prevSize);
        }

        // Click Configuración
        let tempPath = path.join(OUT_DIR, "temp-verify.jpg");
        await page.screenshot({ path: tempPath });
        let prevSize = fs.statSync(tempPath).size;
        fs.unlinkSync(tempPath);
        await clickAndVerify(page, "Configuración", prevSize);

        // Click sección
        tempPath = path.join(OUT_DIR, "temp-verify.jpg");
        await page.screenshot({ path: tempPath });
        prevSize = fs.statSync(tempPath).size;
        fs.unlinkSync(tempPath);
        await clickAndVerify(page, seccion, prevSize);

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
