// /api/generate-exam.js

function json(res, status, obj) {
 res.statusCode = status;
 res.setHeader("Content-Type", "application/json; charset=utf-8");
 res.end(JSON.stringify(obj));
}

function safeString(x, maxLen = 200000) {
 const s = typeof x === "string" ? x : "";
 return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function asEnum(x, allowed, fallback) {
 return allowed.includes(x) ? x : fallback;
}

function toInt(x, fallback) {
 const n = Number.parseInt(String(x), 10);
 return Number.isFinite(n) ? n : fallback;
}

function looksLikeMath(course, pastedText) {

 const s = (String(course)+" "+String(pastedText)).toLowerCase();

 const kw = [
 "matematik","math","algebra","ekvation","funktion",
 "potens","exponent","log","derivata","integral",
 "parabel","f(x)"
 ];

 if (kw.some(k=>s.includes(k))) return true;

 if(/[=<>]/.test(s)&&/[xyz]/.test(s)) return true;
 if(/[a-z]\^\d/.test(s)) return true;

 return false;
}

function pickProviderAndModel({isMath}){

 const deepKey = process.env.DEEPSEEK_API_KEY;

 if(isMath && deepKey){
 return {
 provider:"deepseek",
 model:"deepseek-reasoner"
 };
 }

 return{
 provider:"openai",
 model:process.env.OPENAI_MODEL || "gpt-4o-mini"
 };

}

function buildMockExamSchema(n){

 return{

 type:"json_schema",

 name:"mock_exam",

 strict:true,

 schema:{

 type:"object",

 required:["title","level","questions"],

 properties:{

 title:{type:"string"},

 level:{type:"string"},

 questions:{

 type:"array",

 minItems:n,

 maxItems:n,

 items:{

 type:"object",

 required:[
 "id",
 "type",
 "points",
 "question",
 "options",
 "correct_index",
 "rubric",
 "model_answer"
 ],

 properties:{

 id:{type:"string"},

 type:{type:"string",enum:["mc","short"]},

 points:{type:"number"},

 question:{type:"string"},

 options:{
 type:"array",
 items:{type:"string"}
 },

 correct_index:{type:"integer"},

 rubric:{type:"string"},

 model_answer:{type:"string"}

 }

 }

 }

 }

 }

};

}

async function readJsonBody(req){

 const chunks=[];

 for await(const c of req) chunks.push(c);

 const raw=Buffer.concat(chunks).toString("utf8");

 if(!raw) return{};

 return JSON.parse(raw);

}

function extractOpenAIOutputText(data){

 const t=
 data.output_text ||
 (data.output &&
 data.output[0] &&
 data.output[0].content &&
 data.output[0].content[0] &&
 data.output[0].content[0].text);

 return typeof t==="string"?t:null;

}

async function callDeepSeek({apiKey,model,systemPrompt,userPrompt}){

 const r=await fetch(
 "https://api.deepseek.com/chat/completions",
 {

 method:"POST",

 headers:{
 Authorization:`Bearer ${apiKey}`,
 "Content-Type":"application/json"
 },

 body:JSON.stringify({

 model,

 messages:[
 {role:"system",content:systemPrompt},
 {role:"user",content:userPrompt}
 ],

 temperature:0.2,
 max_tokens:2500

 })

 });

 const raw=await r.text();

 let data;

 try{
 data=JSON.parse(raw);
 }catch{}

 if(!r.ok){

 return{
 ok:false,
 status:r.status,
 raw
 };

 }

 const content=data?.choices?.[0]?.message?.content;

 return{

 ok:true,

 content:String(content||"")

 };

}

module.exports=async function handler(req,res){

 if(req.method!=="POST")
 return json(res,405,{ok:false});

 let parsed;

 try{

 parsed=await readJsonBody(req);

 }catch(e){

 return json(res,400,{
 ok:false,
 error:"bad json"
 });

 }

 const pastedText=safeString(parsed.pastedText);

 if(!pastedText.trim())
 return json(res,400,{
 ok:false,
 error:"Missing pastedText"
 });

 const level=asEnum(parsed.level,["E","C","A"],"C");

 const qType=asEnum(parsed.qType,["mix","mc","short"],"mix");

 const numQuestions=Math.min(
 20,
 Math.max(
 3,
 toInt(parsed.numQuestions,10)
 )
 );

 const course=safeString(parsed.course);

 const isMath=looksLikeMath(course,pastedText);

 const pick=pickProviderAndModel({
 isMath
 });

 const systemPrompt=
 "Return ONLY valid JSON.";

 const userPrompt=

 `Level:${level}
 Questions:${numQuestions}
 Type:${qType}

 Material:
 ${pastedText}`;

 async function runOpenAI(){

 const key=process.env.OPENAI_API_KEY;

 if(!key)
 return{
 ok:false,
 error:"no openai key"
 };

 const r=await fetch(
 "https://api.openai.com/v1/responses",
 {

 method:"POST",

 headers:{
 Authorization:`Bearer ${key}`,
 "Content-Type":"application/json"
 },

 body:JSON.stringify({

 model:pick.model,

 input:[
 {role:"system",content:systemPrompt},
 {role:"user",content:userPrompt}
 ],

 text:{
 format:buildMockExamSchema(numQuestions)
 }

 })

 });

 const raw=await r.text();

 let data;

 try{
 data=JSON.parse(raw);
 }catch{
 return{
 ok:false,
 error:"openai non json"
 };
 }

 const out=extractOpenAIOutputText(data);

 if(!out)
 return{
 ok:false,
 error:"no output"
 };

 return{
 ok:true,
 outputText:out,
 provider:"openai",
 model:pick.model
 };

}

 async function runDeepSeek(){

 const key=process.env.DEEPSEEK_API_KEY;

 if(!key)
 return{
 ok:false
 };

 const r=await callDeepSeek({

 apiKey:key,

 model:pick.model,

 systemPrompt,

 userPrompt

 });

 if(!r.ok)
 return r;

 return{

 ok:true,

 outputText:r.content,

 provider:"deepseek",

 model:pick.model

 };

}

 try{

 let outputText;

 let usedProvider;

 let usedModel;

 let first;

 if(pick.provider==="deepseek")
 first=await runDeepSeek();
 else
 first=await runOpenAI();

 if(first.ok){

 outputText=first.outputText;

 usedProvider=first.provider;

 usedModel=first.model;

 }
 else{

 const fb=await runOpenAI();

 if(!fb.ok)
 return json(res,500,fb);

 outputText=fb.outputText;

 usedProvider=fb.provider;

 usedModel=fb.model;

 }

 let exam;

 try{

 exam=JSON.parse(outputText);

 }
 catch(e){

 if(usedProvider==="deepseek"){

 const fb=await runOpenAI();

 if(!fb.ok)
 return json(res,500,fb);

 outputText=fb.outputText;

 usedProvider=fb.provider;

 usedModel=fb.model;

 exam=JSON.parse(outputText);

 }
 else{

 return json(res,500,{
 ok:false,
 error:"Could not parse model JSON",
 details:String(e),
 outputText
 });

 }

 }

 return json(res,200,{
 ok:true,
 exam,
 meta:{
 provider:usedProvider,
 model:usedModel,
 isMath
 }

 });

 }
 catch(e){

 return json(res,500,{
 ok:false,
 error:"Server error",
 details:String(e)
 });

 }

};
