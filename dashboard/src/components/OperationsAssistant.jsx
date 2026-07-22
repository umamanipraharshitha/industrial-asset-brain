import React, { useState, useEffect } from "react";
import "./OperationsAssistant.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

function getUserId() {
  let id = localStorage.getItem("operations_operator_id");
  if (!id) {
    id = `operator_${Date.now()}`;
    localStorage.setItem("operations_operator_id", id);
  }
  return id;
}

const OperationsAssistant = () => {
  const [mode, setMode] = useState("ingest");
  const [ingestText, setIngestText] = useState("");
  const [question, setQuestion] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiOk, setApiOk] = useState(null);
  const userId = getUserId();

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((d) => setApiOk(d.ok))
      .catch(() => setApiOk(false));
  }, []);

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!ingestText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ingestText, userId }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(`✅ Ingestion successful! Segmented into ${data.chunkCount} database points.`);
        setIngestText("");
      } else {
        setStatus(`❌ Ingestion failed: ${data.error}`);
      }
    } catch (err) {
      setStatus(`❌ Backend unreachable. Start the platform using: npm run start`);
    }
    setLoading(false);
  };

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    const q = question;
    setQuestion("");
    try {
      const res = await fetch(`${API_BASE}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, userId }),
      });
      const data = await res.json();
      const reply = data.ok
        ? data.answer
        : data.message || data.error || "No response found in documentation.";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "❌ Connection to plant server offline." },
      ]);
    }
    setLoading(false);
  };

  const handleChat = async (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", text: chatMessage }]);
    const msg = chatMessage;
    setChatMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.ok ? data.answer : data.error },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "❌ Connection to safety expert systems offline." },
      ]);
    }
    setLoading(false);
  };

  return (
    <div className="operations-assistant">
      <header className="ha-header">
        <div className="title-section">
          <h1>Industrial Operations Brain</h1>
          <p className="ha-subtitle">
            Expert Copilot System • Unified Asset Intelligence & Regulatory Compliance Gateway
          </p>
        </div>
        <div className={`ha-status ${apiOk ? "online" : "offline"}`}>
          <span className="pulse-dot"></span>
          {apiOk === null ? "Diagnosing..." : apiOk ? "Plant Core Online" : "Plant Core Offline"}
        </div>
      </header>

      <nav className="ha-tabs">
        {[
          { id: "ingest", label: "1 · Ingest Plant Manuals & SOPs" },
          { id: "query", label: "2 · Asset Copilot (RAG)" },
          { id: "chat", label: "3 · Safety & Compliance QA" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={mode === tab.id ? "active" : ""}
            onClick={() => { setMode(tab.id); setMessages([]); setStatus(""); }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="ha-main">
        {mode === "ingest" && (
          <section className="ha-panel fade-in">
            <h2>Universal Document Ingestion</h2>
            <p className="section-desc">Paste text from engineering procedures, inspection records, or equipment logs to index it into the plant knowledge base.</p>
            <form onSubmit={handleIngest}>
              <textarea
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
                placeholder="Paste technical documentation details (e.g. Turbine calibration procedures, OISD environmental safety checklist)..."
                rows={12}
              />
              <button type="submit" className="action-btn" disabled={loading || !ingestText.trim()}>
                {loading ? "Index Processing..." : "Index Document Segment"}
              </button>
            </form>
            {status && <p className="ha-feedback">{status}</p>}
          </section>
        )}

        {mode === "query" && (
          <section className="ha-panel RAG-panel fade-in">
            <h2>Plant Knowledge Copilot</h2>
            <div className="ha-chat">
              {messages.length === 0 && (
                <div className="ha-hint">
                  <p>🛡️ Ask a question based on ingested specifications, e.g.:</p>
                  <ul>
                    <li>"What is the maximum torque capacity of Turbine-A?"</li>
                    <li>"Explain the emergency shutdown protocol for boiler 3."</li>
                    <li>"Who performed the last calibration on generator 1?"</li>
                  </ul>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ha-bubble ${m.role}`}>
                  <div className="bubble-sender">{m.role === "user" ? "Operator" : "Operations Brain"}</div>
                  <div className="bubble-text">{m.text}</div>
                </div>
              ))}
            </div>
            <form onSubmit={handleQuery} className="ha-input-row">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Submit query to RAG database..."
                disabled={loading}
              />
              <button type="submit" className="action-btn-short" disabled={loading || !question.trim()}>Query</button>
            </form>
          </section>
        )}

        {mode === "chat" && (
          <section className="ha-panel compliance-panel fade-in">
            <h2>Regulatory compliance & general qa</h2>
            <div className="ha-chat">
              {messages.length === 0 && (
                <div className="ha-hint">
                  <p>⚙️ Consult on heavy-industry regulatory standards (OISD, Factory Act, PESO, environment protection norms):</p>
                  <ul>
                    <li>"What are the ventilation standards under the Factory Act?"</li>
                    <li>"What documents are needed for a PESO license renewal?"</li>
                    <li>"Summarize OISD guidelines for safe pressure vessel operation."</li>
                  </ul>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ha-bubble ${m.role}`}>
                  <div className="bubble-sender">{m.role === "user" ? "Safety Engineer" : "Regulatory System"}</div>
                  <div className="bubble-text">{m.text}</div>
                </div>
              ))}
            </div>
            <form onSubmit={handleChat} className="ha-input-row">
              <input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Ask about guidelines..."
                disabled={loading}
              />
              <button type="submit" className="action-btn-short" disabled={loading || !chatMessage.trim()}>Send</button>
            </form>
          </section>
        )}
      </main>

      <footer className="ha-footer">
        Operator Session ID: <code>{userId}</code>
      </footer>
    </div>
  );
};

export default OperationsAssistant;
