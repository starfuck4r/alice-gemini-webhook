const MAX_HISTORY = 12;
const MAX_TEXT = 4000;

function aliceResponse(text, state = {}) {
  return {
    version: "1.0",
    response: {
      text: String(text || "Извините, сейчас не получилось ответить. Попробуйте ещё раз.").slice(0, 900),
      end_session: false
    },
    session_state: state
  };
}
function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}
function needsSearch(q) {
  return /\b(сейчас|сегодня|вчера|завтра|последн\w*|актуальн\w*|новост\w*|курс\w*|погод\w*|цена\w*|стоимость|найди|поищи|проверь|что произошло|свеж\w*|202[5-9])\b/i.test(q)
    || /\b(latest|today|current|news|weather|price|search|look up|recent)\b/i.test(q);
}
async function searchWeb(query) {
  if (!process.env.SERPER_API_KEY) return "";
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5, gl: "ru", hl: "ru" })
  });
  if (!r.ok) throw new Error("Serper HTTP " + r.status);
  const data = await r.json();
  return (data.organic || []).slice(0, 5).map((x, i) =>
    `${i + 1}. ${x.title || ""}\n${x.snippet || ""}${x.link ? "\n" + x.link : ""}`
  ).join("\n\n");
}
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "alice-gemini-webhook" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const sessionState = body.state?.session || {};
    const isNew = Boolean(body.session?.new);
    const requestText = cleanText(body.request?.original_utterance || body.request?.command?.text || "");
    const history = Array.isArray(sessionState.history) ? sessionState.history.slice(-MAX_HISTORY) : [];

    if (isNew) return res.status(200).json(aliceResponse(
      "Привет! Я голосовой помощник на базе Gemini. Задай вопрос — при необходимости поищу актуальную информацию в интернете.",
      { ...sessionState, history }
    ));
    if (!requestText) return res.status(200).json(aliceResponse("Скажи, пожалуйста, что ты хочешь узнать.", { ...sessionState, history }));
    if (!process.env.GEMINI_API_KEY) return res.status(200).json(aliceResponse(
      "Сервер запущен, но ключ Gemini ещё не добавлен в переменные окружения Vercel.", { ...sessionState, history }
    ));

    let searchContext = "";
    if (needsSearch(requestText) && process.env.SERPER_API_KEY) {
      try { searchContext = await searchWeb(requestText); }
      catch (e) { console.error("Serper search failed:", e.message); }
    }
    const contents = [...history, { role: "user", parts: [{ text: requestText }] }];
    const systemPrompt = "Ты — полезный голосовой ассистент для Яндекс Алисы. Отвечай по-русски, естественно и кратко: обычно 1–3 предложения, без markdown, таблиц и длинных списков. Не выдумывай факты. Если приложены результаты веб-поиска, опирайся на них и отмечай неопределённость." +
      (searchContext ? "\n\nАктуальные результаты поиска Serper (могут быть неполными):\n" + searchContext : "");
    const apiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 180 }
      })
    });
    if (!apiResponse.ok) {
      console.error("Gemini API error:", apiResponse.status, (await apiResponse.text()).slice(0, 500));
      return res.status(200).json(aliceResponse("Не удалось получить ответ от языковой модели. Проверь настройки Gemini и попробуй ещё раз.", { ...sessionState, history }));
    }
    const result = await apiResponse.json();
    const answer = cleanText(result.candidates?.[0]?.content?.parts?.map(p => p.text || "").join(" "))
      || "Не смог сформулировать ответ. Попробуй спросить по-другому.";
    const nextHistory = [...contents, { role: "model", parts: [{ text: answer }] }].slice(-MAX_HISTORY);
    return res.status(200).json(aliceResponse(answer.slice(0, 900), { ...sessionState, history: nextHistory }));
  } catch (e) {
    console.error("Webhook error:", e?.message || e);
    return res.status(200).json(aliceResponse("Произошла техническая ошибка. Попробуй, пожалуйста, ещё раз."));
  }
}
