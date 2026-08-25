-- admin_recovery_codes — vägen tillbaka när varje registrerad enhet är borta.
--
-- VARFÖR TABELLEN FINNS
-- 20260825_admin_passkeys.sql lämnade registrering öppen för varje adminsession,
-- just för att ingen skulle kunna låsa ut sig. Det kravet ändrades 2026-08-25:
-- registrering kräver nu en redan upplåst session. Utan en reservväg hade
-- följden varit att två borttappade enheter kräver att någon går in i
-- databasen för hand.
--
-- Koden lagras ALDRIG i klartext. Bara ett scrypt-hash med eget salt, så en
-- läsning av tabellen ger ingen väg in. Koden visas en enda gång, i det svar
-- som skapar den, och kan därefter inte hämtas igen av någon — inte av Elton,
-- inte av servern.
--
-- Engångs: used_at sätts vid inlösen och en förbrukad kod godtas aldrig igen.
--
-- Icke-destruktiv: bara CREATE TABLE IF NOT EXISTS och GRANT/REVOKE.
-- Rollback: 20260825_admin_recovery_codes_ROLLBACK.sql

create table if not exists public.admin_recovery_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code_hash  text not null,
  salt       text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- En rad per användare: en ny kod ersätter den gamla, så det kan aldrig ligga
-- två giltiga koder samtidigt utan att någon vet om det.
alter table public.admin_recovery_codes enable row level security;

revoke all on table public.admin_recovery_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_recovery_codes to service_role;

comment on table public.admin_recovery_codes is
  'Engångskod för att registrera en ny passkey när alla enheter är borta. '
  'Endast scrypt-hash + salt lagras — koden visas en gång och kan aldrig hämtas igen.';
