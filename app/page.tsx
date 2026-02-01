"use client";

import { useState } from "react";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    setAnswer("");

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();
    setAnswer(data.answer ?? data.error ?? "Okänt fel");
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>AI-frågeruta</h1>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 12 }}
        placeholder="Skriv din fråga…"
      />

      <button onClick={ask} disabled={loading} style={{ marginTop: 12, padding: "10px 14px" }}>
        {loading ? "Tänker…" : "Fråga"}
      </button>

      <div style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>
        {answer}
      </div>
    </main>
  );
}
