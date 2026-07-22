import "dotenv/config";
import { initEmbedder } from "../services/embedder.js";
import { ingestDocument } from "../services/ingestService.js";

const text = process.argv.slice(2).join(" ") || "Sample industrial documentation for testing ingestion.";

await initEmbedder();
const result = await ingestDocument(text, "cli_user");
console.log(`✅ Ingested ${result.chunkCount} chunks (docId: ${result.docId})`);
