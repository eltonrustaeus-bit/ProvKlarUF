// api/_modules.js — serversidans spegel av js/exgen-modules.js.
//
// ExGen är sedan 2026-07-28 en renodlad studieplattform för grundskolan och gymnasiet.
// Körkortsteorin och Högskoleprovet är dolda, inte borttagna: API-rutterna (api/check-role.js
// teoriprovkvot, api/hp.js) och all affärslogik ligger kvar och fungerar. Det dessa flaggor
// styr på serversidan är vad P.E.R och de transaktionella mejlen BERÄTTAR att produkten
// innehåller — annars skulle P.E.R fortsätta tipsa om körkortsträning och länka till en sida
// som numera skickar eleven tillbaka till startsidan.
//
// HÅLL I SYNK med js/exgen-modules.js. Repot har inget byggsteg, så samma två booleans
// finns på två ställen: en för webbläsaren, en för serverfunktionerna. Ändrar du den ena
// ska du ändra den andra.
export const MODULES = Object.freeze({
  korkort: false,
  hp: false,
});

export function moduleEnabled(name) {
  return MODULES[name] === true;
}
