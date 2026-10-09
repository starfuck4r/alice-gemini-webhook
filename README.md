# Alice Gemini Webhook

Webhook for Yandex Dialogs, deployed as a Vercel serverless function.

## Setup
1. Import this folder into a Vercel project.
2. Add `GEMINI_API_KEY` and `SERPER_API_KEY` in Project Settings → Environment Variables (Production).
3. Redeploy after adding the variables.
4. Set the Yandex Dialogs webhook to `https://YOUR-PROJECT.vercel.app/api`.

Conversation context is carried in Yandex Dialogs `state.session`; no Redis or database is used. The handler returns a valid Alice response with `version`, `response`, and `session_state`.

The Serper search is triggered heuristically for queries likely to need current information. Set `SERPER_API_KEY` to enable it; if omitted, normal Gemini responses still work.
