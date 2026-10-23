export const config = {
  port: Number(process.env.PORT || 8792),
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  // URL pública del sitio (para links que van al cliente por WhatsApp, ej. el menú).
  publicUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar",
  waBotSecret: process.env.WA_BOT_SECRET || "",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || "",
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmBaseUrl: (process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
  llmSiteUrl: process.env.LLM_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar",
  llmSiteName: process.env.LLM_SITE_NAME || "Portal 659 wa-bot",
  llmModel:
    process.env.LLM_MODEL ||
    (process.env.LLM_BASE_URL?.includes("openrouter")
      ? "google/gemma-4-31b-it:free"
      : process.env.LLM_BASE_URL?.includes("generativelanguage")
        ? "gemini-flash-latest"
        : "google/gemma-4-31b-it"),
  // Proveedores LLM (orden de prioridad). Solo se incluyen los que tienen API key.
  // Prioridad: gratuitos primero (Gemini, Groq), luego el configurado (NVIDIA/OpenRouter).
  llmProviders: (() => {
    const out = [];
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (geminiKey) out.push({ name: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: geminiKey, model: process.env.GEMINI_MODEL || "gemini-2.0-flash" });
    const groqKey = process.env.GROQ_API_KEY || "";
    if (groqKey) out.push({ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: groqKey, model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" });
    const orKey = process.env.OPENROUTER_API_KEY || "";
    if (orKey) out.push({ name: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: orKey, model: process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free" });
    if (process.env.LLM_API_KEY) out.push({ name: "primary", baseUrl: (process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""), apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || "google/gemma-4-31b-it" });
    // Si no hay ninguno, cae al legacy NVIDIA con LLM_API_KEY vacío (rule fallback).
    return out;
  })(),
  // ————— Anti-ban (pacing humano + rate limits) —————
  replyDelayMinMs: Number(process.env.WA_REPLY_DELAY_MIN_MS || 1200),
  replyDelayMaxMs: Number(process.env.WA_REPLY_DELAY_MAX_MS || 3500),
  replyGapMs: Number(process.env.WA_REPLY_GAP_MS || 900),
  maxMsgPerHour: Number(process.env.WA_MAX_MSG_PER_HOUR || 60),
  maxMsgPerDay: Number(process.env.WA_MAX_MSG_PER_DAY || 500),
  maxNewChatsPerHour: Number(process.env.WA_MAX_NEW_CHATS_PER_HOUR || 15),
  // Modo del bot de WhatsApp: "orders" (toma pedidos) o "concierge" (saludo,
  // menǧ, "��tuviste un problema?" + forwarding al due��o). Default concierge.
  // No se borra c��digo: el flujo de pedidos solo no se entra cuando estǭ off.
  takeOrders: process.env.BOT_TAKE_ORDERS === "1",
  // Modo portal: un solo número sirve a todos los comercios de la zona activa.
  // "portal" = multi-comercio; "vendor" (default) = un comercio por número.
  botMode: process.env.BOT_MODE || "vendor",
  // Timeout de no-respuesta: si hay una pregunta pendiente (persona 1/2, consulta
  // o comprobante) sin contestar por más de esto, el bot avisa que va a ser
  // atendido por una persona y deriva (push al dueño + pausa).
  handoffTimeoutMin: Number(process.env.WA_HANDOFF_TIMEOUT_MIN || 5),
};