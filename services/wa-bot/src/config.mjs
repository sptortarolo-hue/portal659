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
  // Modelo default. Si va por Gemini (free: gemini-2.0-flash) u OpenRouter
// (free vivo en el catálogo), un modelo que sabemos disponible.
  llmModel:
    process.env.LLM_MODEL ||
    (process.env.LLM_BASE_URL?.includes("openrouter")
      ? "google/gemma-4-31b-it:free"
      : process.env.LLM_BASE_URL?.includes("generativelanguage")
        ? "gemini-2.0-flash"
        : "google/gemma-4-31b-it"),
  // ————— Anti-ban (pacing humano + rate limits) —————
  replyDelayMinMs: Number(process.env.WA_REPLY_DELAY_MIN_MS || 1200),
  replyDelayMaxMs: Number(process.env.WA_REPLY_DELAY_MAX_MS || 3500),
  replyGapMs: Number(process.env.WA_REPLY_GAP_MS || 900),
  maxMsgPerHour: Number(process.env.WA_MAX_MSG_PER_HOUR || 60),
  maxMsgPerDay: Number(process.env.WA_MAX_MSG_PER_DAY || 500),
  maxNewChatsPerHour: Number(process.env.WA_MAX_NEW_CHATS_PER_HOUR || 15),
};