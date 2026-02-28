export default async function handler(req, res) {

if(req.method !== "POST"){
return res.status(405).json({ error: "Method not allowed" });
}

try{

const body = req.body || {};
const course = String(body.course || "").trim();
const exams_count = Number(body.exams_count || 0);
const history = Array.isArray(body.history) ? body.history : [];
const mistakes = Array.isArray(body.mistakes) ? body.mistakes : [];

const n = Number.isFinite(exams_count) && exams_count > 0 ? exams_count : history.length;

if(!Array.isArray(history) || history.length < 3 || n < 3){
return res.status(400).json({
ok:false,
error:"Minst 3 prov krävs för att skapa en tillförlitlig rapport."
});
}

const safeCourse = course || "Alla kurser";

// Sammanfatta data minimalt så prompten blir stabil och kort
const last10 = history.slice(-10).map(x => ({
ts: x.ts ?? null,
course: String(x.course || ""),
level: String(x.level || ""),
qType: String(x.qType || ""),
total_points: Number(x.total_points || 0),
max_points: Number(x.max_points || 0),
percent: Number(x.percent || 0)
}));

const last50Mistakes = mistakes.slice(-50).map(m => ({
ts: m.ts ?? null,
course: String(m.course || ""),
id: String(m.id || ""),
points: Number(m.points || 0),
max_points: Number(m.max_points || 0),
question: String(m.question || ""),
feedback: String(m.feedback || ""),
model_answer: String(m.model_answer || "")
}));

const response = await fetch("https://api.openai.com/v1/chat/completions",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
},
body:JSON.stringify({
model:"gpt-4o-mini",
messages:[
{
role:"system",
content:`
Du är en professionell lärare som skriver en kort, tydlig och professionell lärarrapport.

KRAV:
- Rapporten måste baseras på minst 3 prov (API:t skickar antalet).
- Första raden måste tydligt ange: "Baserad på X prov".
- Rapporten ska vara saklig, kort och professionell så den kan delas direkt med en lärare.
- Rapporten ska analysera verklig provdata och beskriva utveckling över tid.
- Strukturera i tydliga rubriker.

FORMAT (exakt rubriker):
Baserad på X prov
Kurs:
Översikt:
Styrkor:
Svagheter:
Rekommenderad träning (nästa 1–2 veckor):
Utveckling:

Begränsa till max 220 ord.
`
},
{
role:"user",
content:`
Antal prov (måste nämnas i första raden): ${n}
Kursfilter: ${safeCourse}

Provhistorik (senaste upp till 10):
${JSON.stringify(last10, null, 2)}

Felbank / tappade poäng (senaste upp till 50):
${JSON.stringify(last50Mistakes, null, 2)}

Skriv rapporten enligt formatet och kraven.
`
}
]
})
});

const data = await response.json();

if(!response.ok){
return res.status(500).json({
ok:false,
error: data?.error?.message || "OpenAI request failed"
});
}

const text = String(data?.choices?.[0]?.message?.content || "").trim();

if(!text){
return res.status(500).json({
ok:false,
error:"Empty report"
});
}

return res.status(200).json({
ok:true,
report:text,
exams_count:n,
course:safeCourse
});

}
catch(e){

return res.status(500).json({
ok:false,
error:String(e)
});

}

}
