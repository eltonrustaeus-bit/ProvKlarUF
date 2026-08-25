// api/_per-graph-data.js — GENERERAD. Redigera aldrig för hand.
//
// Kör `node tools/build-per-graph.mjs` för att skriva om den, och
// `node tools/build-per-graph.mjs --check` för att se om den är inaktuell.
// tests/per/per-brain.test.mjs faller om filen glidit isär från api/.
//
// Genererad ur källkoden, inte skriven: en nod finns bara om filen finns, och
// en kant bara om importen finns.
//
// Läses av api/admin.js. Filen får INTE läsa katalogen vid körning — se
// kommentaren i tools/build-per-graph.mjs om varför adminpanelen låg nere.

export const PER_GRAPH = {
  "noder": [
    {
      "id": "concept-tags",
      "etikett": "concept-tags",
      "fil": "_concept-tags.js",
      "typ": "hjälpare"
    },
    {
      "id": "education",
      "etikett": "education",
      "fil": "_education.js",
      "typ": "hjälpare"
    },
    {
      "id": "mastery-view",
      "etikett": "mastery-view",
      "fil": "_mastery-view.js",
      "typ": "hjälpare"
    },
    {
      "id": "modules",
      "etikett": "modules",
      "fil": "_modules.js",
      "typ": "hjälpare"
    },
    {
      "id": "per-brain",
      "etikett": "per-brain",
      "fil": "_per-brain.js",
      "typ": "modul"
    },
    {
      "id": "per-cache-guard",
      "etikett": "per-cache-guard",
      "fil": "_per-cache-guard.js",
      "typ": "modul"
    },
    {
      "id": "per-cache",
      "etikett": "per-cache",
      "fil": "_per-cache.js",
      "typ": "modul"
    },
    {
      "id": "per-collective",
      "etikett": "per-collective",
      "fil": "_per-collective.js",
      "typ": "modul"
    },
    {
      "id": "per-context",
      "etikett": "per-context",
      "fil": "_per-context.js",
      "typ": "modul"
    },
    {
      "id": "per-core",
      "etikett": "per-core",
      "fil": "_per-core.js",
      "typ": "modul"
    },
    {
      "id": "per-fingerprint",
      "etikett": "per-fingerprint",
      "fil": "_per-fingerprint.js",
      "typ": "modul"
    },
    {
      "id": "per-help",
      "etikett": "per-help",
      "fil": "_per-help.js",
      "typ": "modul"
    },
    {
      "id": "per-identity",
      "etikett": "per-identity",
      "fil": "_per-identity.js",
      "typ": "modul"
    },
    {
      "id": "per-memory",
      "etikett": "per-memory",
      "fil": "_per-memory.js",
      "typ": "modul"
    },
    {
      "id": "per-name",
      "etikett": "per-name",
      "fil": "_per-name.js",
      "typ": "modul"
    },
    {
      "id": "per-pulse",
      "etikett": "per-pulse",
      "fil": "_per-pulse.js",
      "typ": "modul"
    },
    {
      "id": "per-registry",
      "etikett": "per-registry",
      "fil": "_per-registry.js",
      "typ": "modul"
    },
    {
      "id": "per-role",
      "etikett": "per-role",
      "fil": "_per-role.js",
      "typ": "modul"
    },
    {
      "id": "per-sales",
      "etikett": "per-sales",
      "fil": "_per-sales.js",
      "typ": "modul"
    },
    {
      "id": "provia-faq",
      "etikett": "provia-faq",
      "fil": "_provia-faq.js",
      "typ": "hjälpare"
    },
    {
      "id": "provia-kb",
      "etikett": "provia-kb",
      "fil": "_provia-kb.js",
      "typ": "hjälpare"
    },
    {
      "id": "provia-roadmap",
      "etikett": "provia-roadmap",
      "fil": "_provia-roadmap.js",
      "typ": "hjälpare"
    },
    {
      "id": "provia-rules",
      "etikett": "provia-rules",
      "fil": "_provia-rules.js",
      "typ": "hjälpare"
    },
    {
      "id": "admin",
      "etikett": "admin.js",
      "typ": "rutt",
      "fil": "admin.js"
    },
    {
      "id": "check-role",
      "etikett": "check-role.js",
      "typ": "rutt",
      "fil": "check-role.js"
    },
    {
      "id": "explain",
      "etikett": "explain.js",
      "typ": "rutt",
      "fil": "explain.js"
    },
    {
      "id": "generate-exam",
      "etikett": "generate-exam.js",
      "typ": "rutt",
      "fil": "generate-exam.js"
    },
    {
      "id": "grade",
      "etikett": "grade.js",
      "typ": "rutt",
      "fil": "grade.js"
    },
    {
      "id": "hp",
      "etikett": "hp.js",
      "typ": "rutt",
      "fil": "hp.js"
    },
    {
      "id": "teacher-report",
      "etikett": "teacher-report.js",
      "typ": "rutt",
      "fil": "teacher-report.js"
    },
    {
      "id": "flagga:per_answer_cache_enabled",
      "etikett": "per_answer_cache_enabled",
      "typ": "flagga"
    },
    {
      "id": "flagga:per_learner_profile_enabled",
      "etikett": "per_learner_profile_enabled",
      "typ": "flagga"
    },
    {
      "id": "flagga:per_legal_rag_enabled",
      "etikett": "per_legal_rag_enabled",
      "typ": "flagga"
    },
    {
      "id": "flagga:legal_shadow_mode",
      "etikett": "legal_shadow_mode",
      "typ": "flagga"
    },
    {
      "id": "flagga:knowledge_engine_enabled",
      "etikett": "knowledge_engine_enabled",
      "typ": "flagga"
    },
    {
      "id": "flagga:legal_rag_enabled",
      "etikett": "legal_rag_enabled",
      "typ": "flagga"
    },
    {
      "id": "flagga:per_learner_loop_enabled",
      "etikett": "per_learner_loop_enabled",
      "typ": "flagga"
    }
  ],
  "kanter": [
    {
      "från": "mastery-view",
      "till": "concept-tags"
    },
    {
      "från": "per-cache",
      "till": "per-cache-guard"
    },
    {
      "från": "per-cache",
      "till": "per-fingerprint"
    },
    {
      "från": "per-cache",
      "till": "per-core"
    },
    {
      "från": "per-core",
      "till": "provia-kb"
    },
    {
      "från": "per-core",
      "till": "provia-faq"
    },
    {
      "från": "per-core",
      "till": "provia-roadmap"
    },
    {
      "från": "per-core",
      "till": "provia-rules"
    },
    {
      "från": "per-core",
      "till": "modules"
    },
    {
      "från": "per-core",
      "till": "per-identity"
    },
    {
      "från": "per-core",
      "till": "per-name"
    },
    {
      "från": "per-memory",
      "till": "modules"
    },
    {
      "från": "per-role",
      "till": "mastery-view"
    },
    {
      "från": "per-role",
      "till": "concept-tags"
    },
    {
      "från": "provia-faq",
      "till": "modules"
    },
    {
      "från": "provia-faq",
      "till": "education"
    },
    {
      "från": "provia-kb",
      "till": "provia-rules"
    },
    {
      "från": "provia-rules",
      "till": "modules"
    },
    {
      "från": "admin",
      "till": "per-registry"
    },
    {
      "från": "admin",
      "till": "per-brain"
    },
    {
      "från": "admin",
      "till": "per-pulse"
    },
    {
      "från": "check-role",
      "till": "provia-rules"
    },
    {
      "från": "check-role",
      "till": "per-memory"
    },
    {
      "från": "check-role",
      "till": "education"
    },
    {
      "från": "check-role",
      "till": "mastery-view"
    },
    {
      "från": "check-role",
      "till": "per-core"
    },
    {
      "från": "check-role",
      "till": "per-name"
    },
    {
      "från": "explain",
      "till": "per-core"
    },
    {
      "från": "explain",
      "till": "modules"
    },
    {
      "från": "explain",
      "till": "per-collective"
    },
    {
      "från": "explain",
      "till": "provia-kb"
    },
    {
      "från": "explain",
      "till": "per-sales"
    },
    {
      "från": "explain",
      "till": "per-role"
    },
    {
      "från": "explain",
      "till": "per-memory"
    },
    {
      "från": "explain",
      "till": "provia-rules"
    },
    {
      "från": "explain",
      "till": "per-context"
    },
    {
      "från": "explain",
      "till": "per-help"
    },
    {
      "från": "explain",
      "till": "per-name"
    },
    {
      "från": "explain",
      "till": "per-cache"
    },
    {
      "från": "generate-exam",
      "till": "provia-rules"
    },
    {
      "från": "grade",
      "till": "concept-tags"
    },
    {
      "från": "hp",
      "till": "per-core"
    },
    {
      "från": "hp",
      "till": "provia-rules"
    },
    {
      "från": "teacher-report",
      "till": "per-core"
    },
    {
      "från": "teacher-report",
      "till": "per-name"
    },
    {
      "från": "per-cache",
      "till": "flagga:per_answer_cache_enabled"
    },
    {
      "från": "check-role",
      "till": "flagga:per_learner_profile_enabled"
    },
    {
      "från": "explain",
      "till": "flagga:per_learner_profile_enabled"
    },
    {
      "från": "explain",
      "till": "flagga:per_legal_rag_enabled"
    }
  ]
};
