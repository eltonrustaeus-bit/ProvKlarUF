export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, feedback, model_answer, course } = req.body;

    // Kursanpassning: välj kort lärar-guide beroende på kurs
    function normalizeCourse(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    function pickCourseGuide(courseName) {
      const c = normalizeCourse(courseName);

      // Matematik 1/2/3/4, 1a/1b/1c, 2a/2b/2c etc
      if (
        c.includes("matematik") ||
        c.includes("ma") ||
        c.includes("matte") ||
        /\bmat\s*([1-4])/.test(c) ||
        /\bma\s*([1-4])/.test(c)
      ) {
        return `
KURSGUIDE (Matematik):
- Svara strikt med matematiska steg: givna → metod → beräkning → slutsvar.
- Kontrollera alltid: tecken, parenteser, enheter, rimlighet.
- Om uppgiften handlar om funktioner: nollställe (f(x)=0), extrempunkt (topp/botten), symmetrilinje x=-b/(2a).
- Om exponenter/potenser: använd potenslagar och skriv om till samma bas innan du löser.
`;
      }

      // Naturkunskap / Biologi / Kemi / Fysik
      if (
        c.includes("naturkunskap") ||
        c.includes("biologi") ||
        c.includes("kemi") ||
        c.includes("fysik")
      ) {
        return `
KURSGUIDE (Natur/NO):
- Svara med: begrepp → förklaring → orsak/konsekvens → exempel.
- Lyft centrala ord och definiera dem kort.
- Om beräkning förekommer: visa formel, sätt in värden med enheter, räkna, skriv slutsvar med enhet.
- Håll språket tydligt och sakligt, undvik onödiga sidospår.
`;
      }

      // Svenska / Engelska / språk
      if (
        c.includes("svenska") ||
        c.includes("engelska") ||
        c.includes("sv") ||
        c.includes("en")
      ) {
        return `
KURSGUIDE (Språk):
- Svara med: tes/budskap → stöd (exempel) → avslutande slutsats.
- Fokusera på disposition, tydliga sambandsord och korrekt begreppsanvändning.
- Ge konkreta förbättringar: meningsbyggnad, ordval, tydlighet, källhantering (om relevant).
- Exemplet ska visa korrekt struktur (inte bara innehåll).
`;
      }

      // Samhällskunskap / Historia / Religion / Geografi
      if (
        c.includes("samhäll") ||
        c.includes("historia") ||
        c.includes("religion") ||
        c.includes("geografi")
      ) {
        return `
KURSGUIDE (SO):
- Svara med: påstående → förklaring → exempel → koppling (orsak/konsekvens).
- Var noga med centrala begrepp och att skilja fakta från värdering.
- Om resonemang krävs: ta minst två perspektiv och jämför kort.
`;
      }

      // Ekonomi / Företagsekonomi / Nationalekonomi
      if (
        c.includes("ekonomi") ||
        c.includes("företagsekonomi") ||
        c.includes("nationalekonomi") ||
        c.includes("entreprenörskap")
      ) {
        return `
KURSGUIDE (Ekonomi):
- Svara med: definition → modell/formel (om relevant) → tolkning → slutsats.
- Om uppgiften är företagsekonomi: koppla till intäkter/kostnader, lönsamhet, marginaler, kassaflöde.
- Om nationalekonomi: koppla till utbud/efterfrågan, inflation, ränta, BNP, arbetslöshet (beroende på fråga).
- Exemplet ska visa hur man motiverar med begrepp, inte bara räkna.
`;
      }

      // Default om kurs saknas/okänd
      return `
KURSGUIDE (Allmänt):
- Svara tydligt i steg: metod → tips → exempel → minnessätt.
- Utgå från vad som efterfrågas i frågan och vad feedbacken pekar på.
- Håll det kort, konkret och lätt att imitera.
`;
    }

    const courseGuide = pickCourseGuide(course);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Du är en professionell lärare.

Du ska ge korta tips för en fråga eleven fått fel på.
Tipsen måste anpassas efter kursen.

${courseGuide}

Skriv exakt detta format:

Metod:
Kort bästa sättet att lösa uppgiften.

Tips:
Vad eleven ska tänka på.

Exempel:
Kort miniuppgift med lösning.

Minnessätt:
Kort trick eller regel.

Max 200 ord.
`,
          },
          {
            role: "user",
            content: `
Kurs:
${course}

Fråga:
${question}

Feedback:
${feedback}

Modellsvar:
${model_answer}
`,
          },
        ],
      }),
    });

    const data = await response.json();

    // Robust hantering om OpenAI svarar med error-format
    const text =
      data?.choices?.[0]?.message?.content ??
      (data?.error ? `OpenAI error: ${data.error.message || JSON.stringify(data.error)}` : "No response");

    return res.status(200).json({
      ok: true,
      tips: text,
      course_used: course || "",
    });
  } catch (e) {
    return res.status(500).json({
      error: String(e),
    });
  }
}
