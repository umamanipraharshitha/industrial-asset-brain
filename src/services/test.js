// testScheduler.js
import { scheduleAssetMaintenance, startIndustrialScheduler } from "./industrialScheduler.js";

// 1. Start the worker to listen for jobs
startIndustrialScheduler();

// 2. Schedule a one-off maintenance alert for 1 minute from now
(async () => {
  console.log("⏳ Scheduling test maintenance alert for 1 minute from now...");

  const result = await scheduleAssetMaintenance({
    to: "whatsapp:+918374675522",
    text: "⚙️ Test Alert: Perform inspection on turbine-A!",
    sendAt: new Date(Date.now() + 60000).toISOString()
  });

  console.log("📌 Maintenance alert scheduled:", result);
})();
