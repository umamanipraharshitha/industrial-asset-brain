import "dotenv/config";

import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

import { initEmbedder } from "./src/services/embedder.js";
import { embedText } from "./src/services/embedder.js";
import { searchCollection, getOrCreateCollectionDocs, addToCollection } from "./src/services/vectorStore.js";
import { callGemini } from "./src/services/geminiClient.js";
import { ingestDocument, queryDocuments, generalChat } from "./src/services/ingestService.js";

import { parseMaintenanceRequest, buildCronFromParts } from "./src/services/nlpHelpers.js";
import { startIndustrialScheduler, scheduleAssetMaintenance, cancelMaintenanceSchedule } from "./src/services/industrialScheduler.js";
import {
  getUserData,
  upsertAsset,
  addMaintenanceSchedule,
  listMaintenanceSchedules,
  removeMaintenanceSchedule,
  setUserMode,
  incrementMessageCount
} from "./src/services/operationsStore.js";
import { sendWhatsApp } from "./src/services/whatsapp.js";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// CORS for web dashboard (Twilio-free alternative)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;

// Initialize Gemini SDK client for Vision/OCR ingestion
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Start industrial scheduler worker
 */
startIndustrialScheduler();

// Pre-load embedding model on startup
initEmbedder().catch((err) => console.error("❌ Failed to init embedder:", err));

// --- Chunking helper ---
function chunkText(text, chunkSize = 200) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

// --- Gemini Reranking helper ---
async function rerankDocuments(query, docs) {
  if (!docs || docs.length === 0) return [];

  let prompt = `Rank the following document chunks by relevance to the operational query:\nQuery: ${query}\nDocuments:\n`;
  docs.forEach((doc, i) => {
    prompt += `${i + 1}. ${doc.text}\n`;
  });
  prompt += "Return the indices of the most relevant documents first, separated by commas (e.g., 1, 2, 3). Do not include any other text.";

  try {
    const ranking = await callGemini(prompt);
    const indices = ranking
      .split(",")
      .map(x => parseInt(x.trim(), 10) - 1)
      .filter(idx => !isNaN(idx) && idx >= 0 && idx < docs.length);
    
    if (indices.length > 0) {
      return indices.map(idx => docs[idx]);
    }
  } catch (err) {
    console.warn("[WARN] Gemini rerank failed:", err);
  }
  return docs;
}

// --- Image/File text extraction helper using Gemini ---
async function extractTextFromMedia(url, contentType) {
  try {
    console.log(`📥 Downloading media from ${url} (${contentType})...`);
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    console.log("🧬 Sending media to Gemini Vision model for text extraction...");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType: contentType
              }
            },
            { text: "Extract and transcribe all technical details, equipment tags, process metrics, operating instructions, or comments in this drawing or file. Output only the extracted text." }
          ]
        }
      ]
    });
    return response.text || "";
  } catch (err) {
    console.error("❌ Failed to extract text from media:", err);
    throw err;
  }
}

/**
 * Web API — works without Twilio
 */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "Industrial Intelligence backend is running" });
});

app.post("/api/ingest", async (req, res) => {
  try {
    const { text, userId = "web_user" } = req.body;
    const result = await ingestDocument(text, userId);
    res.json({
      ok: true,
      message: `Ingestion successful! Document chunked into ${result.chunkCount} segments.`,
      ...result,
    });
  } catch (err) {
    console.error("❌ /api/ingest error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/query", async (req, res) => {
  try {
    const { question, userId = "web_user" } = req.body;
    const result = await queryDocuments(question, userId);
    if (!result.answer) {
      return res.status(404).json({ ok: false, message: result.message });
    }
    res.json({ ok: true, answer: result.answer, sources: result.sources });
  } catch (err) {
    console.error("❌ /api/query error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const result = await generalChat(message);
    res.json({ ok: true, answer: result.answer });
  } catch (err) {
    console.error("❌ /api/chat error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * WhatsApp webhook
 */
app.post("/whatsapp", async (req, res) => {
  try {
    const { Body, From, MediaUrl0, MediaContentType0 } = req.body;
    const text = (Body || "").trim();
    const hasMedia = !!MediaUrl0;

    // Retrieve or initialize operator session
    const userData = await getUserData(From);

    // --- Message usage limits check ---
    if (userData.tier === "free" && (userData.messageCount || 0) >= 10) {
      await sendWhatsApp({
        to: From,
        text: "⚠️ You have reached your limit of 10 free trial messages. To upgrade to the premium operator tier, please contact plant operations admin.",
      });
      return res.sendStatus(200);
    }

    // Increment message count
    await incrementMessageCount(From);

    // --- Command: Menu reset ---
    if (/^menu$|^mode$/i.test(text)) {
      await setUserMode(From, null);
      await sendWhatsApp({
        to: From,
        text: "Please choose a module by replying with the number:\n\n1️⃣ Ingest asset documents / drawings\n2️⃣ Query industrial knowledge base (RAG)\n3️⃣ Compliance & General Industry QA\n4️⃣ Schedule maintenance & inspections",
      });
      return res.sendStatus(200);
    }

    // --- Mode selection logic ---
    if (userData.mode === null || userData.mode === undefined) {
      if (["1", "2", "3", "4"].includes(text)) {
        await setUserMode(From, text);
        let welcomeMsg = "";
        switch (text) {
          case "1":
            welcomeMsg = "📂 You are now in Mode 1: Ingest asset documents / drawings. Upload files/drawings or paste text to index them into ChromaDB.";
            break;
          case "2":
            welcomeMsg = "🔍 You are now in Mode 2: Query industrial knowledge base. Send your operational query and I will fetch context to answer with citations.";
            break;
          case "3":
            welcomeMsg = "💬 You are now in Mode 3: Compliance & General QA. Ask about Factory Act, OISD, safety guidelines, and general compliance rules.";
            break;
          case "4":
            welcomeMsg = "⏱️ You are now in Mode 4: Maintenance & Inspections. Schedule calibration, overhaul, or inspection checkups for plant equipment.";
            break;
        }
        await sendWhatsApp({ to: From, text: welcomeMsg });
        return res.sendStatus(200);
      } else {
        await sendWhatsApp({
          to: From,
          text: "Welcome to Industrial Asset Brain! Please choose a module by replying with the number:\n\n1️⃣ Ingest asset documents / drawings\n2️⃣ Query industrial knowledge base (RAG)\n3️⃣ Compliance & General Industry QA\n4️⃣ Schedule maintenance & inspections\n\n(Reply 'menu' at any time to return to this screen).",
        });
        return res.sendStatus(200);
      }
    }

    // --- Execute active mode ---
    switch (String(userData.mode)) {
      case "1": {
        let textToIngest = "";

        if (hasMedia) {
          try {
            await sendWhatsApp({ to: From, text: "⏳ Processing image/drawing. Extracting technical text..." });
            textToIngest = await extractTextFromMedia(MediaUrl0, MediaContentType0);
          } catch (err) {
            await sendWhatsApp({ to: From, text: "❌ Failed to extract text from your media. Please try again." });
            return res.sendStatus(200);
          }
        } else {
          textToIngest = text;
        }

        if (!textToIngest.trim()) {
          await sendWhatsApp({ to: From, text: "⚠️ Nothing found to ingest. Please send text or upload a document/drawing." });
          return res.sendStatus(200);
        }

        // Chunk and embed
        const chunks = chunkText(textToIngest);
        const docId = `doc_${Date.now()}`;
        for (let i = 0; i < chunks.length; i++) {
          const [embedding] = await embedText([chunks[i]]);
          await addToCollection("industrial_knowledge", {
            id: `${docId}_${i}`,
            text: chunks[i],
            embedding
          }, From);
        }

        await sendWhatsApp({
          to: From,
          text: `✅ Ingestion successful! Document segmented into ${chunks.length} chunks and indexed in Qdrant/ChromaDB.`,
        });
        break;
      }

      case "2": {
        if (!text) {
          await sendWhatsApp({ to: From, text: "Please send a text question." });
          return res.sendStatus(200);
        }

        const [queryEmbedding] = await embedText([text]);
        
        // Hybrid retrieval: Semantic + Keyword
        const semResults = await searchCollection("industrial_knowledge", queryEmbedding, 5, From);
        const col = await getOrCreateCollectionDocs("industrial_knowledge", From);
        const keywordDocs = col.filter(item => item.text.toLowerCase().includes(text.toLowerCase()));
        
        // Merge & deduplicate
        const merged = [...semResults];
        const semIds = new Set(semResults.map(item => item.id));
        for (const item of keywordDocs) {
          if (!semIds.has(item.id)) {
            merged.push({ ...item, score: "1.000" });
          }
        }

        const finalDocs = merged.slice(0, 5);

        if (finalDocs.length === 0) {
          await sendWhatsApp({
            to: From,
            text: "⚠️ No documentation found. Switch to Mode 1 to ingest some knowledge first.",
          });
          return res.sendStatus(200);
        }

        // Reranking
        const reranked = await rerankDocuments(text, finalDocs);
        const context = reranked.map((d, i) => `[Source #${i + 1}]: ${d.text}`).join("\n\n");

        const prompt = `You are the Expert Industrial Copilot & Asset Brain. Use the following context from plant manuals, engineering drawings, or logs to answer the operator's query.
Your answer must include citation references (e.g. [Source #1]) and a confidence estimation (High/Medium/Low).

Context:
${context}

Question: ${text}
Answer:`;

        const answer = await callGemini(prompt);
        await sendWhatsApp({ to: From, text: answer });
        break;
      }

      case "3": {
        if (!text) {
          await sendWhatsApp({ to: From, text: "Please send a text question." });
          return res.sendStatus(200);
        }
        const prompt = `You are a compliance, safety, and operations regulatory consultant for heavy industries (covering standards like Factory Act, OISD, PESO, environmental norms). Answer the question: ${text}`;
        const answer = await callGemini(prompt);
        await sendWhatsApp({ to: From, text: answer });
        break;
      }

      case "4": {
        if (/stop alerts|unsubscribe|stop$/i.test(text)) {
          const schedules = await listMaintenanceSchedules(From);
          for (const s of schedules) {
            if (s.jobId) await cancelMaintenanceSchedule(s.jobId).catch(() => null);
            await removeMaintenanceSchedule(From, s.id);
          }
          await sendWhatsApp({
            to: From,
            text: "All scheduled maintenance alerts canceled.",
          });
          return res.sendStatus(200);
        }

        if (/list alerts|list schedules/i.test(text)) {
          const schedules = await listMaintenanceSchedules(From);
          if (!schedules.length) {
            await sendWhatsApp({ to: From, text: "You have no scheduled maintenance alerts." });
            return res.sendStatus(200);
          }
          const summary = schedules
            .map(
              (s, i) =>
                `${i + 1}. Asset: ${s.assetTag || "General"} | Task: ${s.text} (${s.scheduled.type} - ${s.scheduled.cron || s.scheduled.sendAt})\nID: ${s.id}`
            )
            .join("\n\n");
          await sendWhatsApp({ to: From, text: `Active Inspection/Maintenance Alerts:\n\n${summary}` });
          return res.sendStatus(200);
        }

        if (/cancel alert\s*(\S+)?/i.test(text)) {
          const m = text.match(/cancel alert\s*(\S+)?/i);
          const id = m?.[1];
          if (!id) {
            await sendWhatsApp({
              to: From,
              text: "Please provide the schedule ID to cancel. Send 'list alerts' first.",
            });
            return res.sendStatus(200);
          }
          const schedules = await listMaintenanceSchedules(From);
          const sched = schedules.find((s) => s.id === id || s.jobId === id);
          if (!sched) {
            await sendWhatsApp({
              to: From,
              text: "Couldn't find that schedule. Send 'list alerts' to check IDs.",
            });
            return res.sendStatus(200);
          }
          await cancelMaintenanceSchedule(sched.jobId).catch(() => null);
          await removeMaintenanceSchedule(From, sched.id);
          await sendWhatsApp({ to: From, text: `✅ Canceled maintenance schedule ${sched.id}` });
          return res.sendStatus(200);
        }

        // Parse maintenance request
        const maintenanceReq = parseMaintenanceRequest(text);
        if (maintenanceReq?.intent === "schedule_maintenance") {
          const reminderText = `Maintenance Alert: Perform ${maintenanceReq.action} on ${maintenanceReq.assetTag}`;

          let sendAt = null;
          if (maintenanceReq.date && maintenanceReq.time) {
            sendAt = new Date(`${maintenanceReq.date}T${maintenanceReq.time}`);
          } else if (maintenanceReq.datetime) {
            sendAt = new Date(maintenanceReq.datetime);
          } else if (maintenanceReq.relativeMinutes) {
            sendAt = new Date(Date.now() + maintenanceReq.relativeMinutes * 60000);
          } else {
            sendAt = new Date(Date.now() + 60 * 1000); // default 1 min
          }

          console.log(`⏱️ Scheduling maintenance alert for ${reminderText} at ${sendAt.toISOString()}`);

          let scheduled;
          if (maintenanceReq.freq === "once" || sendAt) {
            scheduled = await scheduleAssetMaintenance({
              to: From,
              text: reminderText,
              sendAt: sendAt.toISOString(),
              meta: { asset: maintenanceReq.assetTag, action: maintenanceReq.action },
            });
          } else {
            const cron = buildCronFromParts({
              time: maintenanceReq.time || "09:00",
              tz: process.env.TIMEZONE || undefined,
              freq: maintenanceReq.freq,
            });
            scheduled = await scheduleAssetMaintenance({
              to: From,
              text: reminderText,
              cron,
              meta: { asset: maintenanceReq.assetTag, action: maintenanceReq.action },
            });
          }

          // Persist asset + schedule
          const assetId = `${From}::${maintenanceReq.assetTag}`;
          await upsertAsset(From, {
            id: assetId,
            tag: maintenanceReq.assetTag,
            lastAction: maintenanceReq.action,
            createdAt: new Date().toISOString(),
          });
          await addMaintenanceSchedule(From, {
            id: scheduled.jobId,
            jobId: scheduled.jobId,
            assetId,
            assetTag: maintenanceReq.assetTag,
            text: reminderText,
            scheduled,
          });

          await sendWhatsApp({
            to: From,
            text: `✅ Maintenance schedule configured for ${maintenanceReq.assetTag} (${maintenanceReq.action}).`,
          });
          break;
        } else {
          // General alert fallback
          const sendAt = new Date(Date.now() + 60 * 1000); // 1 minute default
          const scheduled = await scheduleAssetMaintenance({
            to: From,
            text: `Operator Reminder: ${text}`,
            sendAt: sendAt.toISOString(),
            meta: { asset: "general" }
          });

          await addMaintenanceSchedule(From, {
            id: scheduled.jobId,
            jobId: scheduled.jobId,
            assetId: `${From}::general`,
            assetTag: "general",
            text: `Operator Reminder: ${text}`,
            scheduled
          });

          await sendWhatsApp({
            to: From,
            text: `✅ Alert scheduled in 1 minute: "${text}".`,
          });
          break;
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in WhatsApp webhook:", err);
    res.sendStatus(500);
  }
});

/**
 * Start server
 */
app.listen(PORT, () =>
  console.log(`🚀 Industrial Asset Brain running on port ${PORT}`)
  + `\n   Web API:  http://localhost:${PORT}/api/health`
  + `\n   WhatsApp: http://localhost:${PORT}/whatsapp`
  + (process.env.MOCK_WHATSAPP === "true" ? " (MOCK mode — no real Twilio sends)" : " (requires Twilio)")
);
