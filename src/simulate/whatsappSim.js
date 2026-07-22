/**
 * Simulates Twilio WhatsApp webhook POSTs against the local backend.
 * Usage: node src/simulate/whatsappSim.js
 *
 * Requires: backend running (node index.js) with MOCK_WHATSAPP=true in .env
 */
import "dotenv/config";
import fetch from "node-fetch";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const FROM = process.env.SIMULATE_FROM || "whatsapp:+919999999999";

async function twilioPost(body) {
  const params = new URLSearchParams({ From: FROM, ...body });
  const res = await fetch(`${BASE}/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.status;
}

async function step(label, body) {
  process.stdout.write(`\n▶ ${label} ... `);
  const status = await twilioPost(body);
  console.log(status === 200 ? "OK (200)" : `FAILED (${status})`);
  if (status !== 200) throw new Error(`Step failed: ${label}`);
  // allow async handler to finish
  await new Promise((r) => setTimeout(r, 1500));
}

async function main() {
  console.log("🧪 Twilio WhatsApp Simulation (Industrial)");
  console.log(`   Backend: ${BASE}/whatsapp`);
  console.log(`   Fake operator: ${FROM}`);

  // health check first
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error("\n❌ Backend not running. Start it first: node index.js");
    process.exit(1);
  }
  console.log("✅ Backend is up");

  await step("Reset to menu", { Body: "menu" });
  await step("Select Mode 1 — Ingest", { Body: "1" });
  await step("Ingest industrial text", {
    Body: "Turbine-A maximum operating speed is 3600 RPM. Overheating occurs at 95 degrees Celsius. Daily inspection of seals is recommended.",
  });
  await step("Reset to menu", { Body: "menu" });
  await step("Select Mode 2 — Document Q&A", { Body: "2" });
  await step("Ask about operating speed", { Body: "What is the maximum operating speed of Turbine-A?" });
  await step("Reset to menu", { Body: "menu" });
  await step("Select Mode 3 — Compliance & General QA", { Body: "3" });
  await step("Ask about Factory Act standards", { Body: "What are the key ventilation guidelines under the Factory Act?" });

  console.log("\n✅ Simulation complete.");
  console.log("   Check the backend terminal for [MOCK WHATSAPP] reply lines.");
}

main().catch((err) => {
  console.error("\n❌ Simulation error:", err.message);
  process.exit(1);
});
