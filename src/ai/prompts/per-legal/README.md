# per-legal

P.E.R juridikläge (uppdragets §27.2). Retrieval krävs för juridiska faktasvar, regler, definitioner, jämförelse med elevsvar.

Bygg på `api/_per-context.js`s `BLOCKED_CONTEXT_REGEX`-saneringsmönster (ADR-referens: samma mönster som redan finns för `pageContext`, och som saknades i `_per-memory.js` tills det fixades i uppföljnings-PR #2 — se `docs/codex_review.md`). **Kopiera det beprövade mönstret, uppfinn inget nytt.**

```js
export default {
  version: "v1",
  systemPrompt: "...",              // inkl. abstain-regel: "insufficient_evidence" om källorna inte räcker
  buildUserPrompt(ctx) { ... },     // ctx: { sanitizedPageContext, retrievedChunks, question }
  outputSchema: perLegalResponseSchema,
};
```

Måste kunna returnera `{ status: "insufficient_evidence", answer: null, reason: "..." }` (§27.2) — får aldrig komplettera saknade fakta från modellminne.

Skrivs i Fas 7.
