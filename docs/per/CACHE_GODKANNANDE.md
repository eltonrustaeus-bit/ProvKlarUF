# Godkänna landningssvar i P.E.R:s svarscache

`landingMode` är oautentiserad. Nya landningsrader skrivs därför som `pending`, och
**endast `approved` rader serveras någonsin**. Utan det steget kan vem som helst få ett
svar cachat och serverat till riktiga besökare (Codex CR-CACHE-003).

Explain-rader skrivs som `approved` direkt — nyckeln är hela payloaden, så en påhittad
fråga kan bara träffa sig själv.

## 1. Se vad som väntar

```sql
select id, left(question_text, 120) as fraga, left(answer, 300) as svar, created_at
  from public.per_answer_cache
 where lane = 'landing' and status = 'pending'
 order by created_at desc
 limit 50;
```

Listan är värd att läsa även när inget ska godkännas: den visar vad besökare faktiskt
frågar landningssidan om.

## 2. Godkänn de rader du läst och står bakom

```sql
update public.per_answer_cache
   set status = 'approved'
 where id in ('...', '...');
```

Avvisa i stället med `status = 'rejected'`. Rader som varken godkänns eller avvisas går
ut av sig själva efter 30 dygn via `expires_at`.

## 3. Vid misstänkt förgiftning

Sonden är textlös men bär `cache_id`:

```sql
select decision, similarity, cache_id, fingerprint_px, created_at
  from public.per_cache_probe
 where created_at > now() - interval '24 hours'
 order by created_at desc;

update public.per_answer_cache set status = 'rejected' where id = '...';
```
