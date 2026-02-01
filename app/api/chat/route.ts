import OpenAI from "openai";

export const runtime = "nodejs"; // kör på server (inte i browsern)

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { question } = await req.json();

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json({ error: "Invalid question" }, { status: 400 });
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: question }],
  });

  const answer = completion.choices?.[0]?.message?.content ?? "";
  return Response.json({ answer });
}
