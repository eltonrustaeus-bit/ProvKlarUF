# DEMO_GUIDE — P.E.R. på 3–5 minuter

Demon visar skillnaden mellan att svara på en fråga och att analysera vad eleven behöver lära sig
härnäst: en elev med en kunskapslucka får en diagnostisk fråga, P.E.R. analyserar svaret, ger
nivåanpassad återkoppling med källor, uppdaterar elevprofilen och väljer nästa steg utifrån
evidensen.

## Innan demon (engångsuppsättning, ~5 min)

**1. Kör migrationen.** Öppna Supabase Dashboard → SQL Editor, klistra in hela
`supabase/migrations/20260727_per_learner_loop.sql` och kör.
Den är icke-destruktiv. Den enda borttagningen är RLS-policyn `exam_questions_select_own`, som
läckte facit och som ingen klientyta använder (verifierat).
Rollback finns i `20260727_per_learner_loop_ROLLBACK.sql` — men för att bara stänga av loopen
behövs ingen rollback, se steg 3.

**2. Verifiera att hela kedjan går igenom mot riktig databas och riktig AI:**
```bash
node --env-file=.env.local scripts/per-e2e-smoke.mjs <ditt-testkonto-uuid>
```
Skriptet kör diagnos → svar → bedömning → felhändelse → mastery → rekommendation → coachning →
profil, och kontrollerar efter varje steg att raderna faktiskt hamnade i databasen och att inget
facit läckte.

**3. Slå på flaggorna för pilotkontot** (SQL Editor). Håll `allowed_user_ids` ifylld — då gäller
flaggan bara de kontona:
```sql
update feature_flags set enabled = true, allowed_user_ids = array['<ditt-uuid>']::uuid[]
where key in ('knowledge_engine_enabled','legal_rag_enabled','per_learner_loop_enabled');
```
Avstängning när som helst: `update feature_flags set enabled = false where key = 'per_learner_loop_enabled';`
Ingen deploy behövs, varken på eller av.

## Demon

**0:00 — Utgångsläget.** Öppna `/juridik.html` inloggad som pilotkontot. Kunskapsprofilen längst
ned visar sex områden i Privatjuridik, alla tomma. *"P.E.R. vet ingenting om den här eleven än."*

**0:30 — Diagnostisk fråga.** Nivå E, "Skriv eget svar", **Starta träning**.
Peka på den blå raden ovanför frågan: *"Vi har inte tränat på det här området än, så jag börjar
med en fråga för att se var du står."* — P.E.R. motiverar sitt val, den slumpar inte.
Peka på "Bygger på:" under frågan — frågan är byggd på en verklig, granskad lagtext, inte på
modellens minne.

**1:00 — Ett ofullständigt svar.** Skriv medvetet något halvrätt, t.ex.:
> *"Det blir inget avtal eftersom svaret kom för sent."*

**1:30 — Analysen.** Visa i tur och ordning:
- **Utfallet**: "Delvis rätt" — inte bara rätt/fel.
- **Återkopplingen**: vad som satt och vad som saknades, i du-form, utan tekniska termer.
- **Kunskapsluckan**: den gula rutan namnger missuppfattningen, inte bara att svaret var fel.
- **Källorna**: "Bedömningen bygger på: Avtalslagen 1 kap 4 §".
  *"Det här är skillnaden mot ett vanligt AI-verktyg — bedömningen är knuten till en källa vi kan peka på."*

**2:30 — Elevprofilen rörde sig.** Scrolla ned. Området har nu ett värde och en underlagsmarkering
("tunt"/"en del"/"gott"). *"Siffran är inte en gissning — den bygger på det försöket, och P.E.R. vet
själv hur säker den är."*

**3:00 — Nästa steg.** Läs motiveringen i rutan: t.ex. *"Du är på väg — en ledtråd räcker nog för
att du ska hitta rätt själv."* Klicka **Visa hur jag ska tänka**.
P.E.R. ger en ledtråd och en motfråga — inte facit. Klicka **Förklara mer** för att visa att
hjälpen trappas upp i steg.
*"Beslutet om vad som ska hända härnäst fattas av regler, inte av en språkmodell. Samma elevläge
ger alltid samma rekommendation, och den går att förklara för en lärare."*

**4:00 — Bevisa att den avstår.** Valfritt men effektfullt: ställ en fråga utanför materialet
(t.ex. formkrav vid fastighetsköp — jordabalken finns inte i korpusen). P.E.R. svarar att den inte
har tillräckligt underlag i stället för att gissa, och elevmodellen lämnas orörd.

**4:30 — Mätbarheten.** Visa i SQL Editor:
```sql
select pipeline_step, model, input_tokens, output_tokens, latency_ms
from ai_usage_events where feature = 'per_learner_loop' order by created_at desc limit 10;

select a.score, a.assessment_method, a.confidence, r.action, r.rationale
from student_attempts a
left join student_recommendations r on r.source_attempt_id = a.id
order by a.created_at desc limit 5;
```
*"Varje AI-anrop är mätt i tokens och millisekunder, och varje rekommendation har sin evidens sparad."*

## Om något inte fungerar

| Symptom | Orsak | Åtgärd |
|---|---|---|
| 403 "P.E.R. elevläge är inte aktiverat" | Flaggorna av, eller kontot inte i `allowed_user_ids` | Steg 3 ovan |
| `no_question_available` | Inga godkända frågor för koncept+nivå och generering avstängd | Kör om med `allowGeneration` (standard på via API:t) |
| `no_chunks_retrieved` | Inga godkända chunks matchar konceptet | Kontrollera `knowledge_chunks.review_status='approved'` |
| 429 | Dygnskvoten (40 bedömningar) nådd | Vänta till nästa dygn eller höj `MAX_ASSESSMENTS_PER_USER_PER_DAY` |
| Tom sida / inget händer | Inte inloggad — sidan läser sessionen från localStorage | Logga in i ExGen först |

## Vad demon INTE visar

- Andra ämnen än Privatjuridik (korpusen är juridik).
- Uppladdning av eget material till korpusen (befintlig OCR-väg, inte kopplad till elevloopen än).
- Lärarvy över klassens kunskapsluckor.
- Kostnad i kronor (tokens mäts, priser är inte ifyllda).
