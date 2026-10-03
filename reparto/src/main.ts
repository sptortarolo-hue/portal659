import { RepartoLocation } from "../reparto-location/src/index";

/**
 * UI de Portal Reparto. La ubicación en vivo vive EN JAVA
 * (RepartoLocationService): esta pantalla solo hace login (teléfono +
 * contraseña del repartidor), lista los delivery ready/sent e
 * inicia/detiene el servicio por pedido.
 */

type Session = {
  serverUrl: string;
  token: string;
  profileId: string;
  storeName: string;
};

type BoardOrder = {
  id: string;
  status: string;
  method: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  total: number;
  items: { name: string; qty: number }[];
  created_at: string;
  assigned_to: string | null;
  pickup_number: number | null;
};

const LS = "portalReparto.session.v1";

const els = {
  loginCard: document.getElementById("loginCard") as HTMLElement,
  mainCard: document.getElementById("mainCard") as HTMLElement,
  serverUrl: document.getElementById("serverUrl") as HTMLInputElement,
  phone: document.getElementById("phone") as HTMLInputElement,
  password: document.getElementById("password") as HTMLInputElement,
  btnLogin: document.getElementById("btnLogin") as HTMLButtonElement,
  btnPerms: document.getElementById("btnPerms") as HTMLButtonElement,
  btnBattery: document.getElementById("btnBattery") as HTMLButtonElement,
  btnRefresh: document.getElementById("btnRefresh") as HTMLButtonElement,
  btnLogout: document.getElementById("btnLogout") as HTMLButtonElement,
  whoLine: document.getElementById("whoLine") as HTMLElement,
  shareLine: document.getElementById("shareLine") as HTMLElement,
  orders: document.getElementById("orders") as HTMLElement,
  log: document.getElementById("log") as HTMLElement,
  statusPill: document.getElementById("statusPill") as HTMLElement,
};

let session: Session | null = null;
let orders: BoardOrder[] = [];
let sharingOrderId = "";

function log(message: string, kind: "info" | "ok" | "error" = "info") {
  const time = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  line.textContent = `${time} · ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function ageText(ms: number): string {
  if (!ms) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 15) return "recién";
  if (s < 60) return `hace ${s} seg`;
  return `hace ${Math.floor(s / 60)} min`;
}

function saveSession(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(LS, JSON.stringify(s));
  else localStorage.removeItem(LS);
}

function api(path: string, init?: RequestInit): Promise<Response> {
  if (!session) throw new Error("Sin sesión");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${session.serverUrl.replace(/\/+$/, "")}${path}`, { ...init, headers });
}

function orderLabel(o: BoardOrder): string {
  const num = o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`;
  return `Pedido ${num} · ${o.customer_name}`;
}

async function doLogin() {
  const serverUrl = els.serverUrl.value.trim() || "https://www.portal659.com.ar";
  const phone = els.phone.value.replace(/\D/g, "");
  const password = els.password.value;
  if (!phone || !password) {
    log("Completá teléfono y contraseña", "error");
    return;
  }
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/auth/repartidor/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.session?.access_token) {
      log(data.error || "No se pudo entrar", "error");
      return;
    }
    saveSession({
      serverUrl,
      token: data.session.access_token,
      profileId: data.profile?.id || "",
      storeName: data.vendor?.store_name || "Tu comercio",
    });
    log(`Hola! Repartís para ${saveSessionName()}`, "ok");
    await enterMain();
  } catch {
    log("Sin conexión al servidor", "error");
  }
}

function saveSessionName(): string {
  return session?.storeName || "tu comercio";
}

async function enterMain() {
  els.loginCard.classList.add("hidden");
  els.mainCard.classList.remove("hidden");
  els.whoLine.textContent = `Repartís para ${saveSessionName()}`;
  try { await RepartoLocation.requestNotifPermission(); } catch {}
  await refreshStatus();
  await loadOrders();
  await reconcileSharing();
}

async function loadOrders(silent?: boolean) {
  if (!session) return;
  try {
    const res = await api("/api/vendor/orders");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!silent) log(data.error || "No se pudieron cargar los pedidos", "error");
      if (res.status === 401 || res.status === 403) doLogout();
      return;
    }
    orders = ((data.orders || []) as BoardOrder[])
      .filter((o) => o.method === "delivery" && (o.status === "ready" || o.status === "sent"))
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    render();
  } catch {
    if (!silent) log("Sin conexión al cargar pedidos", "error");
  }
}

async function claim(id: string) {
  try {
    const res = await api(`/api/vendor/orders/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ action: "claim" }),
    });
    const data = await res.json().catch(() => ({}));
    log(data.ok ? "Pedido tomado" : data.error || "No se pudo tomar", data.ok ? "ok" : "error");
    await loadOrders();
  } catch {
    log("Sin conexión", "error");
  }
}

async function markDelivered(id: string) {
  if (sharingOrderId === id) await stopNative();
  try {
    const res = await api(`/api/vendor/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    const data = await res.json().catch(() => ({}));
    log(data.error ? data.error : "Entregado ✅", data.error ? "error" : "ok");
    await loadOrders();
    await reconcileSharing();
  } catch {
    log("Sin conexión", "error");
  }
}

async function startNative(o: BoardOrder) {
  if (!session) return;
  try {
    const st = await RepartoLocation.status();
    if (!st.locationGranted) {
      log("Primero dale permiso de ubicación (botón 📍)", "error");
      return;
    }
    if (sharingOrderId && sharingOrderId !== o.id) await stopNative();
    await RepartoLocation.startSharing({
      orderId: o.id,
      token: session.token,
      serverUrl: session.serverUrl,
      label: orderLabel(o),
    });
    log("Compartiendo ubicación (funciona con pantalla apagada)", "ok");
    await refreshStatus();
  } catch (e: any) {
    log(`No se pudo iniciar: ${e?.message ?? e}`, "error");
  }
}

async function stopNative() {
  try {
    await RepartoLocation.stopSharing();
    await refreshStatus();
  } catch {}
}

/**
 * Reconciliación automática (sin botón manual): mientras haya pedidos míos
 * en `sent`, el servicio tiene que estar compartiendo uno válido. El plugin
 * comparte de a un pedido: se elige el más antiguo. Si no hay destinos, se
 * apaga. Sin permiso de ubicación no se intenta (la línea de estado guía a
 * otorgarlo).
 */
async function reconcileSharing() {
  if (!session) return;
  let st: { sharing: boolean; orderId: string; locationGranted: boolean } | null = null;
  try {
    const s = await RepartoLocation.status();
    st = { sharing: !!s.sharing, orderId: s.orderId || "", locationGranted: !!s.locationGranted };
  } catch {
    return;
  }
  sharingOrderId = st.sharing ? st.orderId : "";
  const targets = orders
    .filter((o) => o.assigned_to === session?.profileId && o.status === "sent")
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  if (targets.length === 0) {
    if (sharingOrderId) await stopNative();
    else await refreshStatus();
    return;
  }
  if (targets.some((t) => t.id === sharingOrderId)) {
    await refreshStatus();
    return;
  }
  if (sharingOrderId) await stopNative();
  if (!st.locationGranted) {
    await refreshStatus();
    return;
  }
  await startNative(targets[0]);
}

async function refreshStatus() {
  try {
    const st = await RepartoLocation.status();
    sharingOrderId = st.sharing ? st.orderId : "";
    els.statusPill.textContent = sharingOrderId ? "● EN VIVO" : "●";
    els.statusPill.classList.toggle("live", !!sharingOrderId);
    els.shareLine.textContent = sharingOrderId
      ? `🛰️ Compartiendo ${st.label} · último envío ${ageText(st.lastFixAt)}`
      : !st.locationGranted
        ? "📍 Sin permiso de ubicación: tocalo en 📍 Permisos GPS (después elegí “Permitir siempre”)."
        : st.locationGranted && !st.backgroundGranted
          ? "📍 Para compartir con la pantalla apagada elegí “Permitir siempre” en 📍 Permisos GPS."
          : "";
    render();
  } catch {}
}

function render() {
  els.orders.innerHTML = "";
  const mine = orders.filter((o) => o.assigned_to === session?.profileId);
  const free = orders.filter((o) => !o.assigned_to);
  if (orders.length === 0) {
    els.orders.innerHTML = `<div class="order"><p class="meta">No hay pedidos para entregar ahora.</p></div>`;
    return;
  }
  if (free.length > 0) {
    const h = document.createElement("div");
    h.className = "order";
    h.innerHTML = `<h3>🟡 Disponibles (${free.length})</h3>`;
    els.orders.appendChild(h);
    free.forEach((o) => els.orders.appendChild(card(o, "free")));
  }
  if (mine.length > 0) {
    const h = document.createElement("div");
    h.className = "order";
    h.innerHTML = `<h3>🟢 Mis entregas (${mine.length})</h3>`;
    els.orders.appendChild(h);
    mine.forEach((o) => els.orders.appendChild(card(o, "mine")));
  }
}

function card(o: BoardOrder, kind: "free" | "mine"): HTMLElement {
  const div = document.createElement("div");
  div.className = "order";
  const items = (o.items || []).map((i) => `${i.qty}x ${i.name}`).join(", ");
  const sharing = sharingOrderId === o.id;
  div.innerHTML =
    `<h3>${o.customer_name} <span class="pill ${o.status === "sent" ? "live" : ""}">${o.status === "sent" ? "En camino" : "Listo"}</span>${sharing ? `<span class="pill live">EN VIVO</span>` : ""}</h3>` +
    (o.pickup_number != null ? `<p class="meta">Pedido Nro. ${o.pickup_number} · $${Number(o.total).toLocaleString("es-AR")}</p>` : `<p class="meta">$${Number(o.total).toLocaleString("es-AR")}</p>`) +
    `<p class="meta">${items}</p>` +
    (o.customer_address ? `<p class="addr">📍 ${o.customer_address}</p>` : "");
  const btns = document.createElement("div");
  btns.className = "btns";
  if (kind === "free") {
    const b = document.createElement("button");
    b.textContent = "🙋 Tomar";
    b.onclick = () => claim(o.id);
    btns.appendChild(b);
  } else {
    // Sin botón manual: la ubicación se comparte sola (ver reconcileSharing).
    const d = document.createElement("button");
    d.textContent = "✅ Entregado";
    d.onclick = () => markDelivered(o.id);
    btns.appendChild(d);
  }
  if (o.customer_phone) {
    const w = document.createElement("button");
    w.textContent = "💬 WA";
    w.className = "ghost";
    w.onclick = () => window.open(`https://wa.me/${o.customer_phone!.replace(/\D/g, "")}`, "_blank");
    btns.appendChild(w);
  }
  div.appendChild(btns);
  return div;
}

function doLogout() {
  stopNative().catch(() => {});
  saveSession(null);
  orders = [];
  els.mainCard.classList.add("hidden");
  els.loginCard.classList.remove("hidden");
  els.orders.innerHTML = "";
  els.password.value = "";
}

function bind() {
  els.btnLogin.onclick = doLogin;
  els.btnRefresh.onclick = loadOrders;
  els.btnLogout.onclick = doLogout;
  els.btnBattery.onclick = () => RepartoLocation.requestBatteryExemption().catch(() => {});
  els.btnPerms.onclick = async () => {
    try {
      const st = await RepartoLocation.requestLocationPermissions();
      if (!st.locationGranted) log("Permiso denegado: la ubicación no va a funcionar", "error");
      else if (!st.backgroundGranted) log("Ahora volvé a tocar 📍 y elegí “Permitir siempre”", "info");
      else log("Permisos listos ✅", "ok");
      await refreshStatus();
    } catch {}
  };
}

async function init() {
  bind();
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const s = JSON.parse(raw) as Session;
      if (s.token) {
        saveSession(s);
        els.serverUrl.value = s.serverUrl;
        await enterMain();
        return;
      }
    }
  } catch {}
  log("Portal Reparto listo. Entrá con tu teléfono y contraseña de repartidor.");
}

// Primer uso: exclusión de batería (Xiaomi/Samsung matan el servicio si no).
window.addEventListener("load", () => {
  try {
    if (localStorage.getItem("portalReparto.askedBattery") !== "1") {
      localStorage.setItem("portalReparto.askedBattery", "1");
      RepartoLocation.requestBatteryExemption().catch(() => {});
    }
  } catch {}
});

init();
// Poll liviano: pedidos + reconciliación del sharing automático (sin botón).
// loadOrders en silencio para no spamear "sin conexión" cuando no hay red.
setInterval(() => {
  if (session) {
    loadOrders(true)
      .then(() => reconcileSharing())
      .catch(() => {});
  }
}, 10000);
