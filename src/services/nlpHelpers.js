// src/services/nlpHelpers.js

/**
 * Heuristic-based parser for industrial maintenance, inspection, and calibration requests.
 * Parses strings like:
 * - "Schedule calibration for turbine-3 daily at 9am"
 * - "inspect boiler-A tomorrow at 3pm"
 * - "set maintenance reminder for generator-5 weekly at 08:00"
 */
export function parseMaintenanceRequest(text) {
  text = text.toLowerCase();

  const triggers = /(schedule|inspect|calibrate|maintenance|alert|reminder|check|overhaul)/i;
  if (!triggers.test(text)) return null;

  // Extract time: 9am, 09:00, 3pm, tomorrow at 3pm
  const timeMatch = text.match(/(\b\d{1,2}(:\d{2})?\s*(am|pm)?\b)/i);
  const dateMatch = text.match(/\b(tomorrow|today|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i);

  // Extract frequency
  let freq = null;
  if (/\bdaily|every day|each day\b/.test(text)) freq = "daily";
  if (/\bweekly|every week|each week\b/.test(text)) freq = "weekly";
  if (/\bonce|one time|tomorrow\b/.test(text) || /on \d{4}-\d{2}-\d{2}/.test(text)) freq = "once";

  // Identify asset tag and task/action
  let assetTag = "general_asset";
  let action = "inspection";

  // Match: "inspect [asset]" or "calibrate [asset]" or "maintenance for [asset]"
  const actionMatch = text.match(/(inspect|calibrate|maintenance for|overhaul|check|alert for)\s+([a-zA-Z0-9\-_ ]{2,30})/i);
  if (actionMatch) {
    const rawAction = actionMatch[1].toLowerCase();
    if (rawAction.includes("inspect")) action = "inspection";
    else if (rawAction.includes("calibrate")) action = "calibration";
    else if (rawAction.includes("overhaul")) action = "overhaul";
    else if (rawAction.includes("maintenance")) action = "maintenance";
    else action = "check";

    assetTag = actionMatch[2].trim();
    // Clean up trailing helper words from asset tag
    assetTag = assetTag.replace(/\b(daily|every day|weekly|tomorrow|today|at|on|for)\b/g, "").trim();
  }

  const time = timeMatch ? timeMatch[0].trim() : null;
  const date = dateMatch ? dateMatch[0].trim() : null;

  // Normalize time: e.g. "9am" -> "09:00"
  let normTime = null;
  if (time) {
    const t = time.toLowerCase().replace(/\s+/g, "");
    const ampm = t.includes("am") || t.includes("pm");
    if (ampm) {
      const m = t.match(/(\d{1,2})(?::(\d{2}))?(am|pm)/);
      if (m) {
        let hh = parseInt(m[1], 10);
        const mm = m[2] || "00";
        const ampm2 = m[3];
        if (ampm2 === "pm" && hh !== 12) hh += 12;
        if (ampm2 === "am" && hh === 12) hh = 0;
        normTime = `${String(hh).padStart(2, "0")}:${mm}`;
      }
    } else if (t.includes(":")) {
      const mm = t.split(":")[1].padEnd(2, "0");
      const hh = String(t.split(":")[0]).padStart(2, "0");
      normTime = `${hh}:${mm}`;
    } else {
      const hh = String(parseInt(t, 10)).padStart(2, "0");
      normTime = `${hh}:00`;
    }
  }

  return {
    intent: "schedule_maintenance",
    assetTag: assetTag || "general_asset",
    action,
    time: normTime,
    date: (date === "today" ? new Date().toISOString().slice(0, 10) : (date === "tomorrow" ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : (/\d{4}-\d{2}-\d{2}/.test(date || "") ? date : null))),
    freq: freq || (date ? "once" : "daily")
  };
}

/**
 * Build a cron expression for daily/weekly schedules.
 */
export function buildCronFromParts({ time = "09:00", tz, freq = "daily" }) {
  const [hh, mm] = (time || "09:00").split(":").map(s => s.padStart(2, "0"));
  if (freq === "daily") {
    return `${mm} ${hh} * * *`;
  }
  if (freq === "weekly") {
    return `${mm} ${hh} * * 1`; // Mondays
  }
  return `${mm} ${hh} * * *`;
}
