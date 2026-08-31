# SplitBill

Scan a receipt, let everyone claim their items, split tax/service proportionally, and share a payment QR to collect what's owed. See [SplitBillplan.md](SplitBillplan.md) for the full design.

Phase 1 (this codebase) covers the core web flow: payer login, receipt upload + review, guest join by link/code, live item claiming over Socket.io, and manual payment tracking. Mobile and the AI chatbox are later phases.

## Structure

- `backend/` — Fastify REST API + Socket.io realtime server + Postgres schema
- `web/` — Next.js 16 web app (payer dashboard + guest join/claim UI)

## Prerequisites

You'll need accounts/keys for:

1. **Postgres** — any instance works locally (Docker, a local install) or hosted (Render Postgres, Supabase).
2. **Firebase project** (payer auth) — create one at the [Firebase console](https://console.firebase.google.com/), enable **Authentication → Google sign-in**, then:
   - For the **backend**: Project settings → Service accounts → generate a private key (gives you `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
   - For the **web app**: Project settings → General → your web app's config (gives you `NEXT_PUBLIC_FIREBASE_*` values).
3. **Gemini API key** (receipt extraction, free) — get one at [Google AI Studio](https://aistudio.google.com/apikey), no card required. The free tier (Gemini 2.5 Flash, a few hundred requests/day) is plenty for this app; only the receipt-upload feature depends on it.

## Backend setup

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL, GUEST_JWT_SECRET, Firebase, Anthropic
npm run db:migrate     # applies backend/src/db/schema.sql
npm run dev            # http://localhost:4000
```

`GUEST_JWT_SECRET` can be any long random string (e.g. `openssl rand -hex 32`) — it signs guest session tokens, not real payment credentials.

## Web app setup

```bash
cd web
npm install
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_API_BASE_URL + Firebase web config
npm run dev            # http://localhost:3000
```

## Deploying

- **Web → Vercel**: import the repo, set the project root to `web/`, add the `NEXT_PUBLIC_*` env vars from `.env.local.example`.
- **Backend → Render**: create a Web Service pointed at `backend/`, build command `npm install`, start command `npm start`, add the env vars from `.env.example`. Add a Render Postgres instance and run `npm run db:migrate` once against it (e.g. via the Render shell).
- After both are deployed, set `WEB_APP_URL` (backend) and `NEXT_PUBLIC_API_BASE_URL` (web) to each other's real URLs, and update the CORS/socket origins if you changed the defaults.

Local file uploads (`backend/src/lib/storage.js`) are saved to `backend/uploads/` and served statically — this doesn't survive a Render redeploy. Swap in a Supabase/Firebase Storage adapter with the same `saveImage(buffer, mimeType) -> url` signature before relying on this in production (see the comment in that file).

## Known limitations (by design, for Phase 1)

- Guest Firebase-less join is stateless-JWT based; a payer's browser session isn't refreshed mid-socket-connection, so a very long-lived tab may need a refresh after the Firebase ID token expires (~1 hour).
- No bill history list yet — creating a bill takes you straight to it. Listing past bills is Phase 4.
- AI chat-based adjustments (Phase 3) and the mobile app (Phase 2) aren't built yet — see `SplitBillplan.md` for the roadmap.
