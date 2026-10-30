/**
 * Switch de diseño del panel (Tasty Station UI).
 *
 * El rediseño se prueba sin tocar producción con un interruptor POR
 * NAVEGADOR: cookie `portal659-panel-ui` (source of truth, sobrevive al
 * F5 y se comparte entre pestañas) + `?ui=tasty|classic` en la URL para
 * mandar un link de prueba. Default: `classic` → nada cambia para nadie.
 *
 * El estado se materializa como `data-panel-ui` en <html> (script pre-paint
 * en src/app/layout.tsx → cero flash) y el CSS lo consume
 * (html[data-panel-ui="tasty"] …, ver src/app/styles/tasty-station.css).
 *
 * Repartidores/compradores no lo usan: el switch solo afecta a los shells
 * del panel (/vendor y /admin), que llevan la clase `.ts-ui`.
 */

export const PANEL_UI_COOKIE = "portal659-panel-ui";
export const PANEL_UI_ATTR = "data-panel-ui";
export type PanelUi = "classic" | "tasty";
export const PANEL_UI_DEFAULT: PanelUi = "classic";

export function isPanelUi(v: unknown): v is PanelUi {
  return v === "classic" || v === "tasty";
}

/** Valor vigente desde un header Cookie (server: layout/route handlers). */
export function readPanelUiCookie(cookieHeader: string | null | undefined): PanelUi {
  if (!cookieHeader) return PANEL_UI_DEFAULT;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === PANEL_UI_COOKIE) {
      const v = rest.join("=").trim();
      if (isPanelUi(v)) return v;
    }
  }
  return PANEL_UI_DEFAULT;
}

/** Cookie para fijar el modo (1 año, path=/). */
export function panelUiCookie(value: PanelUi): string {
  return `${PANEL_UI_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * Script pre-paint (inline en <head>, corre antes del primer paint como el
 * del tema): lee `?ui=` → cookie → localStorage y deja el attribute en
 * <html>. Si la URL pide un modo válido, lo fija y limpia el query.
 */
export const PANEL_UI_PRE_PAINT = `(function(){try{
var q=new URLSearchParams(location.search).get("ui");
var v=q==="tasty"||q==="classic"?q:null;
if(!v){var m=document.cookie.match(/(?:^|;\\s*)portal659-panel-ui=(tasty|classic)/);v=m?m[1]:null}
if(!v){try{v=localStorage.getItem("portal659-panel-ui")}catch(e){}}
if(v!=="tasty"&&v!=="classic")v="classic";
document.documentElement.setAttribute("data-panel-ui",v);
if(q==="tasty"||q==="classic"){document.cookie="portal659-panel-ui="+v+"; Path=/; Max-Age=31536000; SameSite=Lax";
try{localStorage.setItem("portal659-panel-ui",v)}catch(e){}
var u=new URL(location.href);u.searchParams.delete("ui");history.replaceState(null,"",u.toString())}
}catch(e){document.documentElement.setAttribute("data-panel-ui","classic")}})();`;

/** Cambia el modo en caliente (cliente): attribute + cookie + evento. */
export function applyPanelUi(value: PanelUi): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(PANEL_UI_ATTR, value);
  document.cookie = panelUiCookie(value);
  try {
    localStorage.setItem("portal659-panel-ui", value);
  } catch {
    /* modo privado / storage lleno: la cookie alcanza */
  }
  window.dispatchEvent(new Event("panel-ui-changed"));
}

/** Modo vigente leyendo el attribute que dejó el script pre-paint. */
export function currentPanelUi(): PanelUi {
  if (typeof document === "undefined") return PANEL_UI_DEFAULT;
  const v = document.documentElement.getAttribute(PANEL_UI_ATTR);
  return isPanelUi(v) ? v : PANEL_UI_DEFAULT;
}
