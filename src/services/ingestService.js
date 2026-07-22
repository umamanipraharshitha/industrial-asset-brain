import { embedText } from "./embedder.js";
import { searchCollection, getOrCreateCollectionDocs, addToCollection } from "./vectorStore.js";
import { callGemini } from "./geminiClient.js";

const COLLECTION = "industrial_knowledge";

export function chunkText(text, chunkSize = 200) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

export async function ingestDocument(text, userId = "web_user") {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    throw new Error("Nothing to ingest. Provide text content.");
  }

  const chunks = chunkText(trimmed);
  const docId = `doc_${Date.now()}`;

  for (let i = 0; i < chunks.length; i++) {
    const [embedding] = await embedText([chunks[i]]);
    await addToCollection(COLLECTION, {
      id: `${docId}_${i}`,
      text: chunks[i],
      embedding,
    }, userId);
  }

  return { docId, chunkCount: chunks.length };
}

export async function rerankDocuments(query, docs) {
  if (!docs || docs.length === 0) return [];

  let prompt = `Rank the following industrial documentation chunks by relevance to the operational query:\nQuery: ${query}\nDocuments:\n`;
  docs.forEach((doc, i) => {
    prompt += `${i + 1}. [Source: Chunk ${i + 1}] ${doc.text}\n`;
  });
  prompt += "Return the indices of the most relevant documents first, separated by commas (e.g., 1, 2, 3). Do not include any other text.";

  try {
    const ranking = await callGemini(prompt);
    const indices = ranking
      .split(",")
      .map((x) => parseInt(x.trim(), 10) - 1)
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < docs.length);

    if (indices.length > 0) {
      return indices.map((idx) => docs[idx]);
    }
  } catch (err) {
    console.warn("[WARN] Gemini rerank failed:", err);
  }
  return docs;
}

export async function queryDocuments(question, userId = "web_user") {
  const text = (question || "").trim();
  if (!text) {
    throw new Error("Please provide a query.");
  }

  const [queryEmbedding] = await embedText([text]);

  const semResults = await searchCollection(COLLECTION, queryEmbedding, 5, userId);
  const col = await getOrCreateCollectionDocs(COLLECTION, userId);
  const keywordDocs = col.filter((item) => item.text.toLowerCase().includes(text.toLowerCase()));

  const merged = [...semResults];
  const semIds = new Set(semResults.map((item) => item.id));
  for (const item of keywordDocs) {
    if (!semIds.has(item.id)) {
      merged.push({ ...item, score: "1.000" });
    }
  }

  const finalDocs = merged.slice(0, 5);
  if (finalDocs.length === 0) {
    return { answer: null, message: "No operational documents found in database. Ingest plant manuals or safety procedures first." };
  }

  const reranked = await rerankDocuments(text, finalDocs);
  const context = reranked.map((d, i) => `[Source Reference #${i + 1}]:\n${d.text}`).join("\n\n");
  
  const prompt = `You are the Expert Industrial Copilot & Asset Brain. Use the following context from plant manuals, engineering drawings, or logs to answer the operator's query.
Your answer must include:
1. A clear, direct answer to the query.
2. Citation references (e.g., "[Source Reference #1]") where applicable.
3. A Confidence Score (High, Medium, or Low) based on how well the context covers the user query, along with a brief reason.

Context:
${context}

Query: ${text}

Answer:`;

  const answer = await callGemini(prompt);

  return { answer, sources: finalDocs.length };
}

export async function generalChat(message) {
  const text = (message || "").trim();
  if (!text) {
    throw new Error("Please provide a message.");
  }
  
  const prompt = `You are a compliance, safety, and operations regulatory consultant for heavy industries (covering standards like Factory Act, OISD, PESO, environmental norms). Help the user with their request: ${text}`;
  const answer = await callGemini(prompt);
  return { answer };
}
