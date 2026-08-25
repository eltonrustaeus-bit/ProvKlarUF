-- admin_passkeys — Face ID och Touch ID framför per.html.
--
-- Två tabeller, båda helt oåtkomliga för klienter. Servern läser dem med
-- service_role; ingen policy finns eftersom ingen roll ska kunna nå dem alls.
--
-- VARFÖR public_key ÄR text OCH INTE bytea
-- PostgREST lämnar bytea som en \x-prefixad hexsträng, och konverteringen fram
-- och tillbaka är ett extra felläge utan vinst. Nyckeln lagras därför som
-- base64url-text, precis som den ser ut i WebAuthn-svaret.
--
-- VARFÖR UTMANINGARNA HAR EN EGEN TABELL
-- En utmaning måste kunna användas exakt en gång. Apples passkeys rapporterar
-- alltid signaturräknare 0, så räknaren kan inte upptäcka en återspelad
-- signatur — raderingen av utmaningsraden är det enda som gör det.
--
-- Icke-destruktiv: bara CREATE TABLE IF NOT EXISTS och GRANT/REVOKE.
-- Rollback: 20260825_admin_passkeys_ROLLBACK.sql

create table if not exists public.admin_passkeys (
  credential_id text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  public_key    text not null,
  counter       bigint not null default 0 check (counter >= 0),
  transports    text[],
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists idx_admin_passkeys_user on public.admin_passkeys (user_id);

create table if not exists public.admin_passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_passkey_challenges_lookup
  on public.admin_passkey_challenges (user_id, kind, expires_at desc);

-- Husmönstret från 20260727_per_learner_loop.sql: RLS på, allt återkallat,
-- grants bara till service_role. "RLS på + noll policyer" ensamt räcker inte.
alter table public.admin_passkeys           enable row level security;
alter table public.admin_passkey_challenges enable row level security;

revoke all on table public.admin_passkeys           from public, anon, authenticated;
revoke all on table public.admin_passkey_challenges from public, anon, authenticated;

grant select, insert, update, delete on table public.admin_passkeys           to service_role;
grant select, insert, delete         on table public.admin_passkey_challenges to service_role;

comment on table public.admin_passkeys is
  'WebAuthn-enheter för adminens step-up till per.html. Ingen klientåtkomst.';
comment on table public.admin_passkey_challenges is
  'Engångsutmaningar, TTL 120 s. Raderas vid användning — det är det enda som '
  'upptäcker en återspelad signatur, eftersom Apples passkeys alltid rapporterar räknare 0.';
