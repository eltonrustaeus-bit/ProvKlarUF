-- 20260823_mock_mastery_server_side.sql — servern äger mockprovens mastery.
--
-- FÖRE: app.html:1064 (updateMastery) läste user_profiles.mastery, räknade om
-- den i webbläsaren och skrev tillbaka hela objektet. Tre problem, alla med
-- konsekvenser i produktionsdata:
--
--   1. ELEVEN KUNDE SKRIVA VAD SOM HELST. RLS gav update på egen rad, så en
--      elev kunde sätta sin egen mastery till 100 på varje begrepp. Det som
--      P.E.R. sedan skulle använda för att välja svårighetsgrad var alltså
--      klientkontrollerat.
--   2. LÄS–ÄNDRA–SKRIV UTAN LÅS. Två flikar som rättade prov samtidigt skrev
--      över varandras hela mastery-objekt.
--   3. NYCKELN VAR MODELLENS FRITEXT. 99 begrepp från tre elever, varav
--      "Konsumenträtt"/"Konsumenträttigheter" och "Tro och heder"/"Tro och
--      Heder" var samma sak räknad två gånger.
--
-- EFTER: api/grade.js anropar apply_mock_mastery() med en normaliserad nyckel
-- (api/_concept-tags.js). Funktionen låser raden, väger in svårighetsgraden och
-- skriver. Klientens update-rätt tas bort.

begin;

-- ── 1. Formen på mastery ──────────────────────────────────────────────────
--
-- Kolumnen är jsonb och behåller sin form: ett objekt med en nyckel per
-- begrepp. Värdet går från ett tal till ett objekt, eftersom en siffra utan
-- antal försök inte går att lita på — 100 efter ett försök och 100 efter tolv
-- är inte samma kunskap, och rekommendationsmotorn behöver skilja dem åt.
--
--   { "fullmakt": { "score": 72, "attempts": 5, "label": "Fullmakt",
--                   "last_seen": "2026-08-23T18:00:00Z" } }
--
-- Gamla rader med rena tal migreras vid första skrivningen, inte i förväg:
-- en engångskonvertering av 104 nycklar skulle behöva gissa antalet försök,
-- och ett gissat attempts-värde är sämre än inget.

create or replace function public.apply_mock_mastery(
  p_user_id    uuid,
  p_concept    text,
  p_label      text,
  p_ratio      real,          -- 0..1, andel av frågans poäng
  p_difficulty real default 0.5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mastery   jsonb;
  v_entry     jsonb;
  v_old       real;
  v_attempts  int;
  v_weight    real;
  v_new       real;
  v_label     text;
begin
  if p_user_id is null or p_concept is null or p_concept = '' then
    return null;
  end if;

  -- Låser raden. Utan detta skriver två samtidiga rättningar över varandra.
  select coalesce(mastery, '{}'::jsonb) into v_mastery
  from public.user_profiles
  where id = p_user_id
  for update;

  if not found then
    insert into public.user_profiles (id, mastery)
    values (p_user_id, '{}'::jsonb)
    on conflict (id) do nothing;
    v_mastery := '{}'::jsonb;
  end if;

  v_entry := v_mastery -> p_concept;

  -- Gammal form: ett rent tal. Ny form: ett objekt. Båda läses.
  if v_entry is null then
    v_old := 50; v_attempts := 0;
  elsif jsonb_typeof(v_entry) = 'number' then
    v_old := (v_entry #>> '{}')::real; v_attempts := 0;
  else
    v_old := coalesce((v_entry ->> 'score')::real, 50);
    v_attempts := coalesce((v_entry ->> 'attempts')::int, 0);
  end if;

  -- Etiketten sätts en gång och ändras inte. Eleven ska inte se raden byta namn.
  v_label := coalesce(nullif(v_entry ->> 'label', ''), nullif(p_label, ''), p_concept);

  /* Vikten sjunker med antalet försök: de första svaren ska flytta siffran
     snabbt, senare svar ska inte kunna rasera en väl belagd nivå. Samma tanke
     som Elo-K i apply_legal_mastery och apply_hp_mastery (K=24 första tio
     försöken, sedan 12) — här uttryckt som en glidande vikt i stället för två
     steg, eftersom mockproven kommer i mycket ojämnare takt.

     Svårighetsgraden viktar utfallet: rätt på en svår fråga ska ge mer än rätt
     på en lätt. Utan den mäter mastery hur lätta prov eleven väljer. */
  v_weight := greatest(0.08, 0.35 / (1 + v_attempts * 0.35));
  v_new := v_old + v_weight * ((p_ratio * 100) * (0.6 + 0.8 * p_difficulty) - v_old);
  v_new := greatest(0, least(100, v_new));

  v_mastery := jsonb_set(
    v_mastery,
    array[p_concept],
    jsonb_build_object(
      'score', round(v_new::numeric, 1),
      'attempts', v_attempts + 1,
      'label', v_label,
      'last_seen', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    true
  );

  update public.user_profiles
  set mastery = v_mastery, updated_at = now()
  where id = p_user_id;

  return v_mastery -> p_concept;
end;
$$;

comment on function public.apply_mock_mastery is
  'Atomisk mastery-uppdatering for mockprov. Nyckeln maste vara normaliserad av api/_concept-tags.js.';

revoke all on function public.apply_mock_mastery(uuid, text, text, real, real) from public, anon, authenticated;

-- ── 2. Klienten slutar äga siffran ────────────────────────────────────────
--
-- Update-rätten var det enda som lät webbläsaren skriva mastery. Insert
-- behålls: app.html skapar fortfarande sin egen profilrad vid första besöket,
-- och den raden innehåller ingen mastery.
--
-- Select behålls oförändrad — eleven ska kunna se sin egen kunskapsprofil.

drop policy if exists user_profiles_update_own on public.user_profiles;

/* Hela grant-listan sätts om, inte bara update. Supabase default-grantar ALL på
   tabeller i public till anon och authenticated, så raden bar fortfarande
   DELETE och TRUNCATE för varje inloggad användare. Ingen delete-policy fanns,
   så RLS stoppade dem — men då vilar skyddet på ett enda lager, och det är
   precis kombinationen som gjorde att concept_collective_stats och
   learner_profile_facts behövde härdas i efterhand.

   Kvar: select (eleven ska se sin egen profil) och insert (app.html skapar sin
   profilrad vid första besöket). Ingen kod raderar user_profiles — kontoradering
   sker via cascade från auth.users. */
revoke all on public.user_profiles from public, anon, authenticated;
grant select, insert on public.user_profiles to authenticated;

commit;
