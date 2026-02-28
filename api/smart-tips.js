export default async function handler(req,res){

if(req.method !== "POST"){
return res.status(405).json({error:"Method not allowed"});
}

try{

const {question, feedback, model_answer, course} = req.body;

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
Du är en professionell lärare.

Du ska ge korta tips för en fråga eleven fått fel på.

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
`
},

{
role:"user",
content:`

Kurs:
${course}

Fråga:
${question}

Feedback:
${feedback}

Modellsvar:
${model_answer}

`
}

]

})

});

const data = await response.json();

const text = data.choices[0].message.content;

res.status(200).json({
ok:true,
tips:text
});

}
catch(e){

res.status(500).json({
error:String(e)
});

}

}
