// Capturas set 2 para manuales: catálogo (editor/opciones/volumen/promos),
// Preparación y Costo, variantes (moda) e inventario (sub-vistas).
// Uso:
//   node scripts/capture-manuales-2.mjs                 (set base, Pastas Rossi)
//   MANUAL_SET=comercio MANUAL_PREFIX=comercio- MANUAL_EMAIL=vendedor5@test.com node scripts/capture-manuales-2.mjs
//   MANUAL_SET=moda MANUAL_PREFIX=moda- MANUAL_EMAIL=vendedor7@test.com node scripts/capture-manuales-2.mjs

import { chromium } from "@playwright/test";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "manuales", "capturas");
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const EMAIL = process.env.MANUAL_EMAIL || "vendedor2@test.com";
const PASSWORD = process.env.MANUAL_PASSWORD || "test123456";
const PREFIX = process.env.MANUAL_PREFIX || "";
const SET = process.env.MANUAL_SET || "base";

// [slug, pasos...] — cada paso: {tab?, sheet?, click?, wait?}
const FLOWS =
  SET === "comercio"
    ? [
        { slug: "inventario-compras", tab: "Inventario", sub: "Compras" },
        { slug: "inventario-conteos", tab: "Inventario", sub: "Conteos" },
        { slug: "inventario-kardex", tab: "Inventario", sub: "Kardex" },
        { slug: "inventario-reposicion", tab: "Inventario", sub: "Reposición" },
      ]
    : SET === "moda"
      ? [{ slug: "variantes", tab: "Catálogo", product: true }]
      : SET === "reparto"
        ? [
            // OJO: tablero loguea como repartidor y cambia la sesión del contexto;
            // por eso va último.
            { slug: "equipo", config: "Repartidores" },
            { slug: "pedido", pedidoSent: true },
            { slug: "vincular", vincular: "KX7M2Q" },
            { slug: "tablero", repartidor: true },
          ]
      : [
          { slug: "catalogo-editor", tab: "Menú", nuevo: true },
          { slug: "catalogo-opciones", tab: "Menú", sub: "Opciones" },
          { slug: "catalogo-volumen", tab: "Menú", sub: "Precios por volumen" },
          { slug: "catalogo-promos", config: "Promos" },
          { slug: "costos-preparacion", tab: "Preparación y Costo" },
          { slug: "preparacion-insumos", tab: "Preparación y Costo", sub: "Insumos", fila: "Harina" },
          { slug: "preparacion-editor", tab: "Preparación y Costo", fila: "Costo \\$" },
          { slug: "preparacion-semaforo", tab: "Preparación y Costo", semaforo: true },
        ];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

async function snap(page, slug, vp) {
  const tmp = path.join(OUT_DIR, `${PREFIX}${slug}-${vp.name}.tmp.jpg`);
  const fin = path.join(OUT_DIR, `${PREFIX}${slug}-${vp.name}.jpg`);
  await page.screenshot({ path: tmp, fullPage: false });
  let img = sharp(tmp);
  const meta = await img.metadata();
  if (meta.width > 800) img = img.resize(800);
  await img.jpeg({ quality: 85 }).toFile(fin);
  fs.unlinkSync(tmp);
  console.log(`OK ${PREFIX}${slug}-${vp.name}.jpg (${fs.statSync(fin).size} bytes)`);
}

function visibleBtn(page, name) {
  return page.getByRole("button", { name }).filter({ visible: true }).first();
}

async function closeOverlays(page) {
  try {
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Cerrar"]');
      if (b) b.click();
    });
    await page.waitForTimeout(400);
  } catch {}
}

// Ir a un tab que puede estar en el bottom nav, la sidebar o el sheet "Más".
// Primero se prueba el nav directo (bottom/sidebar); el sheet solo si no está.
async function goTab(page, label, isMobile) {
  // Solo el bottom nav (fixed): el header tiene su propio botón "Menú"
  const bottomNav = page.locator("nav").filter({ hasText: "Más" }).first();
  const direct =
    (await bottomNav.count()) > 0
      ? bottomNav.locator("button", { hasText: label }).filter({ visible: true }).first()
      : page.locator("nav").locator("button", { hasText: label }).filter({ visible: true }).first();
  // Evitar falsos positivos del header (ej. "☰Menú"): el label debe coincidir razonablemente
  if ((await direct.count()) > 0) {
    const txt = ((await direct.textContent()) || "").trim();
    if (txt.length < label.length + 12) {
      await direct.click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      return;
    }
  }
  if (isMobile) {
    const moreBtn = page.locator("nav").locator("button", { hasText: "Más" }).last();
    if ((await moreBtn.count()) > 0) await moreBtn.click({ timeout: 5000 });
    await page.waitForTimeout(800);
    const sheet = page.locator('div[class*="rounded-t-2xl"]');
    const inSheet = sheet.locator("button", { hasText: label });
    if ((await inSheet.count()) > 0) {
      await inSheet.first().click({ timeout: 8000 });
    } else {
      await closeOverlays(page);
      await visibleBtn(page, new RegExp(label)).click({ timeout: 8000 });
    }
    await page.waitForTimeout(1200);
    await closeOverlays(page);
  } else {
    await visibleBtn(page, new RegExp(label)).click({ timeout: 8000 });
    await page.waitForTimeout(1200);
  }
}

// Ir a una sección de Configuración (drill-down mobile)
async function goConfigSection(page, label, isMobile) {
  if (isMobile) {
    const moreBtn = page.locator("nav").locator("button", { hasText: "Más" }).last();
    if ((await moreBtn.count()) > 0) await moreBtn.click({ timeout: 5000 });
    await page.waitForTimeout(800);
    const sheet = page.locator('div[class*="rounded-t-2xl"]');
    const inSheet = sheet.locator("button", { hasText: "Configuración" });
    if ((await inSheet.count()) > 0) await inSheet.first().click({ timeout: 8000 });
    else await visibleBtn(page, /Configuración/).click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    await closeOverlays(page);
  } else {
    await visibleBtn(page, /Configuración/).click({ timeout: 8000 });
    await page.waitForTimeout(1200);
  }
  // Si quedó un detalle abierto, volver al menú
  const back = page.locator("button", { hasText: /^‹/ }).filter({ visible: true }).first();
  if ((await back.count()) > 0) {
    await back.click({ timeout: 5000 });
    await page.waitForTimeout(800);
  }
  await visibleBtn(page, new RegExp(label)).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await closeOverlays(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("portal659_onboarded", "1"));
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/vendor/dashboard**", { timeout: 15000 });
    await page.waitForTimeout(2000);
    const isMobile = vp.name === "mobile";

    for (const flow of FLOWS) {
      try {
        if (flow.repartidor) {
          // Login como repartidor (teléfono + contraseña) en /vincular
          await page.goto(`${BASE}/vincular`, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(1200);
          await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll("input"));
            const tel = inputs.find(
              (i) => (i.placeholder || "").toLowerCase().includes("tel") || i.type === "tel" || i.inputMode === "tel"
            );
            const pwd = inputs.find((i) => i.type === "password");
            const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            if (tel) {
              tel.focus();
              set.call(tel, "2215550134");
              tel.dispatchEvent(new Event("input", { bubbles: true }));
              tel.dispatchEvent(new Event("change", { bubbles: true }));
            }
            if (pwd) {
              pwd.focus();
              set.call(pwd, "reparto123");
              pwd.dispatchEvent(new Event("input", { bubbles: true }));
              pwd.dispatchEvent(new Event("change", { bubbles: true }));
            }
            const btns = Array.from(document.querySelectorAll("button"));
            const b = btns.find((x) => /ingresar|entrar|continuar/i.test(x.textContent || "") && x.offsetParent !== null);
            if (b) b.click();
          });
          await page.waitForURL("**/vendor/dashboard**", { timeout: 15000 });
          try {
            await page.waitForFunction(
              () => /Disponibles|Mis entregas|Sin pedidos|Tomar pedido/i.test(document.body.innerText),
              { timeout: 15000 }
            );
          } catch {}
          await page.waitForTimeout(1500);
          await snap(page, flow.slug, vp);
          continue;
        }
        if (flow.vincular) {
          // Página de vinculación con código, sin login
          await page.goto(`${BASE}/vincular?code=${flow.vincular}`, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(1500);
          await snap(page, flow.slug, vp);
          continue;
        }
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.goto(`${BASE}/vendor/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        if (flow.config) {
          await goConfigSection(page, flow.config, isMobile);
        } else if (flow.tab) {
          await goTab(page, flow.tab, isMobile);
        }

        if (flow.pedidoSent) {
          // Abrir el detalle del pedido delivery en camino (sent)
          await goTab(page, "Pedidos", isMobile);
          // Verificar que caímos en Pedidos; si no, clickear el item del sidebar
          const onPedidos = await page.evaluate(() =>
            /Buscar nombre|En camino|Por aceptar/i.test(document.body.innerText)
          );
          if (!onPedidos) {
            const side = page.locator("aside").locator("button", { hasText: "Pedidos" }).first();
            if ((await side.count()) > 0) await side.click({ timeout: 8000 });
            else {
              const anyNav = page.locator("nav").locator("button", { hasText: /^Pedidos/ }).first();
              if ((await anyNav.count()) > 0) await anyNav.click({ timeout: 8000 });
            }
            await page.waitForTimeout(1500);
          }
          try {
            await page.waitForFunction(() => /En camino/i.test(document.body.innerText), { timeout: 12000 });
          } catch {}
          await page.waitForTimeout(800);
          const opened = await page.evaluate(() => {
            // 1) "Ver detalle →" dentro de la tarjeta de María Vecina
            // 2) si no hay, la tarjeta clickeable (cursor pointer)
            const all = Array.from(document.querySelectorAll("*"));
            const nameEl = all.find(
              (el) => el.childElementCount === 0 && (el.textContent || "").trim() === "María Vecina"
            );
            if (!nameEl) return false;
            // Ancestro MÁS CHICO con "Ver detalle →" que NO contenga otro pedido
            let link = null;
            let el = nameEl.parentElement;
            for (let i = 0; i < 8 && el && el.tagName !== "BODY" && !link; i++) {
              const links = Array.from(el.querySelectorAll("*")).filter(
                (x) => (x.textContent || "").trim() === "Ver detalle →" && x.offsetParent !== null
              );
              if (links.length > 0 && !/Pedro Vecino/.test(el.textContent || "")) link = links[0];
              el = el.parentElement;
            }
            if (link) {
              link.scrollIntoView({ block: "center" });
              link.click();
              return true;
            }
            let card = nameEl.parentElement;
            for (let i = 0; i < 10 && card && card.tagName !== "BODY"; i++) {
              if (card.offsetParent !== null && getComputedStyle(card).cursor === "pointer") {
                card.scrollIntoView({ block: "center" });
                card.click();
                return true;
              }
              card = card.parentElement;
            }
            return false;
          });
          console.log(`  pedido sent: ${opened ? "abierto" : "NO ENCONTRADO"}`);
          await page.waitForTimeout(2500);
          // Scrollear al mapa/reparto dentro del modal
          await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll("h1,h2,h3,p,span,div"));
            const t = els.find(
              (x) => /Reparto en curso|repartidor|Asignado|Compartiendo/i.test(x.textContent || "") && x.offsetParent !== null
            );
            if (t) {
              t.scrollIntoView({ block: "center" });
              window.scrollBy(0, -80);
            }
          });
          await page.waitForTimeout(500);
        }

        if (flow.nuevo) {
          // Abrir formulario de producto nuevo (+ Plato / + Producto)
          const add = page.getByRole("button", { name: /(\+|Nuevo) (Plato|Producto)/ }).filter({ visible: true }).first();
          if ((await add.count()) > 0) await add.click({ timeout: 8000 });
          else {
            // Fallback: primer botón con "+" del toolbar
            await visibleBtn(page, /\+ Plato|\+ Producto/).click({ timeout: 8000 });
          }
          await page.waitForTimeout(1200);
          await closeOverlays(page);
        }

        if (flow.sub) {
          // Sub-vista (solapa) dentro del tab ya abierto
          await visibleBtn(page, new RegExp(flow.sub)).click({ timeout: 8000 });
          await page.waitForTimeout(1500);
          await closeOverlays(page);
        }

        if (flow.fila) {
          // Clic en la fila (botón) que contenga el texto dado y scroll a ella
          try {
            await page.waitForFunction((t) => document.body.innerText.includes(t), flow.fila, { timeout: 12000 });
          } catch {}
          await page.waitForTimeout(800);
          try {
            const btn = page
              .getByRole("button", { name: new RegExp(flow.fila) })
              .filter({ visible: true })
              .first();
            await btn.scrollIntoViewIfNeeded();
            await btn.click({ timeout: 8000 });
            console.log(`  click fila ${flow.fila}`);
          } catch (e) {
            console.log(`  fila ${flow.fila} falló:`, String(e).split("\n")[0].slice(0, 100));
          }
          await page.waitForTimeout(2000);
          // OJO: no llamar closeOverlays acá (cerraría el editor recién abierto)
          // Scrollear al editor abierto (h3 con el nombre o costo en vivo)
          await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll("h1,h2,h3,p,label,legend"));
            const t = els.find(
              (x) => /Costo total|Guardar cambios|Crear preparación/.test(x.textContent || "") && x.offsetParent !== null
            );
            if (t) {
              t.scrollIntoView({ block: "center" });
              window.scrollBy(0, -100);
            }
          });
          await page.waitForTimeout(500);
        }

        if (flow.semaforo) {
          // Expandir el bloque 🚦 Semáforo con su Editar
          try {
            const det = page.locator("details").filter({ hasText: "Semáforo" }).first();
            if ((await det.count()) > 0) {
              const sum = det.locator("summary").first();
              if ((await sum.count()) > 0) await sum.click({ timeout: 5000 });
              else await det.click({ timeout: 5000 });
            } else {
              const ed = page.getByRole("button", { name: /Editar/ }).filter({ visible: true }).first();
              await ed.scrollIntoViewIfNeeded();
            }
            console.log("  semáforo expandido");
          } catch (e) {
            console.log("  semáforo falló:", String(e).split("\n")[0].slice(0, 100));
          }
          await page.waitForTimeout(1000);
          await closeOverlays(page);
        }

        if (flow.product) {
          // El editor se abre con el botón Editar de la fila (solo visible en
          // desktop): asegurar viewport desktop, abrir, y recién después
          // capturar cada viewport con el editor ya abierto.
          if (vp.name !== "desktop") {
            await page.setViewportSize({ width: 1280, height: 800 });
            await page.waitForTimeout(800);
          }
          try {
            await page.waitForFunction(() => document.body.innerText.includes("Bolso"), { timeout: 12000 });
          } catch {}
          await page.waitForTimeout(800);
          // Botón Editar directo de la fila (visible en desktop): la fila es el
          // div más chico que contiene el nombre Y el botón Editar
          try {
            const fila = page
              .locator("div", { hasText: "Bolso cuero" })
              .filter({ has: page.getByRole("button", { name: "Editar" }) })
              .last();
            await fila.scrollIntoViewIfNeeded();
            await fila.getByRole("button", { name: "Editar" }).first().click({ timeout: 8000 });
            console.log("  click Editar en fila");
          } catch (e) {
            console.log("  editor falló:", String(e).split("\n")[0].slice(0, 120));
          }
          await page.waitForTimeout(1500);
          await closeOverlays(page);
          // Volver al viewport pedido antes de capturar
          if (vp.name === "mobile") {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForTimeout(800);
          }
          // Llevar a la vista el editor (variantes) si se abrió inline
          await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll("h1,h2,h3,p,label,legend"));
            const t = els.find(
              (x) => /variante/i.test(x.textContent || "") && x.offsetParent !== null
            );
            if (t) {
              t.scrollIntoView({ block: "start" });
              window.scrollBy(0, -80);
            }
          });
          await page.waitForTimeout(500);
        }

        await snap(page, flow.slug, vp);
      } catch (e) {
        console.error(`ERROR ${flow.slug} (${vp.name}): ${String(e).split("\n")[0].slice(0, 160)}`);
      }
    }
    await context.close();
  }
  await browser.close();
  console.log("set2 done");
}

main().catch(console.error);
