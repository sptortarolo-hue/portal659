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
const EMAIL = process.env.MANUAL_EMAIL || "vendedor1@test.com";
const PASSWORD = process.env.MANUAL_PASSWORD || "test123456";
const PREFIX = process.env.MANUAL_PREFIX || "";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

// [slug, url, description]
const DIRECT_URLS =
  process.env.MANUAL_SET === "comercio"
    ? [
        // En comercio solo el micrositio es propio; home/login/registro los aporta el set base.
        // El prefijo MANUAL_PREFIX ("comercio-") se antepone solo.
        ["alta-micrositio", `/tienda/${process.env.MANUAL_MICROSLUG || "verduleria-la-huerta"}`, "Micrositio del comercio"],
      ]
    : [
        ["alta-home", "/", "Home de Portal 659"],
        ["alta-login", "/login", "Página de login"],
        ["alta-register", "/register", "Página de registro"],
        ["alta-micrositio", `/tienda/${process.env.MANUAL_MICROSLUG || "pastas-rossi"}`, "Micrositio del comercio"],
      ];

// [slug, tabText, description]
const DASHBOARD_TABS =
  process.env.MANUAL_SET === "comercio"
    ? [
        ["alta-dashboard", null, "Dashboard - pestaña Pedidos"],
        ["recepcion-pedidos", null, "Panel de pedidos"],
        ["mostrador-grid", "Mostrador", "Mostrador - grilla de productos"],
        ["catalogo", "Catálogo", "Catálogo del comercio"],
        ["caja", "Caja", "Caja - cierre y turnos"],
      ]
    : [
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
  const slugPrefixed = `${PREFIX}${slug}`;
  const tempPath = path.join(OUT_DIR, `${slugPrefixed}-${viewport.name}.tmp.jpg`);
  const finalPath = path.join(OUT_DIR, `${slugPrefixed}-${viewport.name}.jpg`);

  await page.screenshot({ path: tempPath, fullPage: false });
  await optimizeImage(tempPath, finalPath);
  const size = fs.statSync(finalPath).size;
  console.log(`OK ${slugPrefixed}-${viewport.name}.jpg (${size} bytes) - ${description}`);
}

async function closeMoreSheet(page) {
  try {
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Cerrar"]');
      if (b) b.click();
    });
    await page.waitForTimeout(500);
  } catch {}
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
    if (!clicked) console.log(`  Click "${text}" no encontrado (sin botón visible)`);

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

        // Items que viven en el sheet "Más" (móvil): abrirlo primero y clickear dentro
        const inMoreSheet = ["Catálogo", "Caja", "Clientes"].includes(tabText);
        if (inMoreSheet && viewport.name === "mobile") {
          const moreBtn = page.locator("nav").locator("button", { hasText: "Más" }).last();
          if ((await moreBtn.count()) > 0) await moreBtn.click({ timeout: 5000 });
          await page.waitForTimeout(800);
          const sheet = page.locator('div[class*="rounded-t-2xl"]');
          const itemInSheet = sheet.locator("button", { hasText: tabText });
          if ((await itemInSheet.count()) > 0) await itemInSheet.first().click({ timeout: 5000 });
          else await clickAndVerify(page, tabText, previousSize);
        } else {
          await clickAndVerify(page, tabText, previousSize);
        }
        if (viewport.name === "mobile") await closeMoreSheet(page);

        await capturePage(page, slug, viewport, description);
      } catch (e) {
        console.error(`ERROR ${slug} (${viewport.name}): ${e.message}`);
      }
    }
  }

  // Capturar secciones de Configuración (clicks reales de Playwright: los
  // sintéticos vía evaluate no siempre disparan el drill-down mobile).
  // OJO: goto a la misma URL no recarga (SPA) y el drill-down queda abierto;
  // se fuerza reload para arrancar siempre desde el menú de secciones.
  for (const [slug, seccion, description] of CONFIG_SECTIONS) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      try {
        // Pasar por la home desmonta el dashboard y resetea su estado
        // (goto a la misma URL no recarga en la SPA y el drill-down queda abierto)
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.goto(`${BASE}/vendor/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        const isMobile = viewport.name === "mobile";
        if (isMobile) {
          // Abrir sheet "Más" (botón del bottom nav, no el drawer)
          const moreBtn = page.locator("nav").locator("button", { hasText: "Más" }).last();
          if ((await moreBtn.count()) > 0) await moreBtn.click({ timeout: 5000 });
          await page.waitForTimeout(800);
          // Click "Configuración" dentro del sheet
          const sheet = page.locator('div[class*="rounded-t-2xl"]');
          const cfgInSheet = sheet.locator("button", { hasText: "Configuración" });
          if ((await cfgInSheet.count()) > 0) await cfgInSheet.first().click({ timeout: 5000 });
          else await page.getByRole("button", { name: "Configuración" }).last().click({ timeout: 5000 });
          await page.waitForTimeout(1200);
          await closeMoreSheet(page);
        } else {
          await page.getByRole("button", { name: "Configuración" }).first().click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }

        // Click en la sección (item del menú con su descripción).
        // OJO: .first() a secas toma el botón del drawer oculto de desktop;
        // hay que filtrar solo visibles.
        const visibleBtn = (name) =>
          page.getByRole("button", { name }).filter({ visible: true }).first();
        // Si el drill-down quedó en un detalle (deep-link ?seccion= o sección
        // persistida), volver al menú con "‹ Configuración" antes de buscar el item.
        // OJO: el "‹" es aria-hidden, no va en el accessible name: buscar por texto.
        const backBtn = page.locator("button", { hasText: /^‹/ }).filter({ visible: true }).first();
        if ((await backBtn.count()) > 0) {
          await backBtn.click({ timeout: 5000 });
          await page.waitForTimeout(800);
        }
        try {
          await visibleBtn(new RegExp(seccion)).click({ timeout: 8000 });
        } catch (e) {
          const dbg = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button")).filter((x) => x.offsetParent !== null);
            return {
              total: btns.length,
              muestra: btns.slice(0, 30).map((x) => (x.textContent || "").trim().slice(0, 30)),
              cfg: localStorage.getItem("portal659-config-comercio") || localStorage.getItem("portal659-config-gastro"),
              url: window.location.href,
              w: window.innerWidth,
            };
          });
          console.log(`  DBG ${slug} (${viewport.name}):`, JSON.stringify(dbg).slice(0, 600));
          throw e;
        }
        await page.waitForTimeout(1200);

        // Scrollear al título de la sección abierta (si no, la captura queda arriba)
        await page.evaluate((label) => {
          const h = Array.from(document.querySelectorAll("h3")).find(
            (x) => (x.textContent || "").trim().startsWith(label) && x.offsetParent !== null
          );
          if (h) {
            h.scrollIntoView({ block: "start" });
            window.scrollBy(0, -80);
          }
        }, seccion === "Impresora" ? "Impresora" : seccion);
        await page.waitForTimeout(500);
        // La sección Impresora tiene un acordeón interno ("Impresora térmica")
        // que nace colapsado: hay que expandirlo con un segundo click.
        if (seccion === "Impresora") {
          const inner = visibleBtn(/Impresora térmica/);
          if ((await inner.count()) > 0) await inner.click({ timeout: 5000 });
          await page.waitForTimeout(1000);
          // Scrollear al contenido expandido
          const prueba = visibleBtn(/Imprimir prueba/);
          if ((await prueba.count()) > 0) await prueba.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
        }
        if (viewport.name === "mobile") await closeMoreSheet(page);

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
