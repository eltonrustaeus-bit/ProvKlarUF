module.exports = async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY;

  // OBS: Läcker INTE nyckeln. Visar bara metadata.
  const info = {
    hasKey: Boolean(key),
    type: typeof key,
    length: key ? key.length : 0,
    startsWith: key ? key.slice(0, 7) : null,   // t.ex. "sk-proj"
    endsWith: key ? key.slice(-4) : null,       // sista 4 tecken
    hasWhitespace: key ? /\s/.test(key) : null, // space/newline/tab
    hasQuotes: key ? /['"]/.test(key) : null
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(info, null, 2));
};
