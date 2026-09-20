import("./src/bot.mjs").then(async ({ handleInbound }) => {
  process.env.LLM_API_KEY = "";
  const vendor = { id: "v1", store_name: "Test Burger", vertical: "gastronomia", enabled: true };
  const r = await handleInbound({ vendor, waId: "5491100000000", body: "hola" });
  console.log("REPLIES:", r.replies.length, "| primer reply:", (r.replies[0] || "").slice(0, 120));
}).catch((e) => {
  console.error("CRASH:", e.message);
  console.error(e.stack);
  process.exit(1);
});
