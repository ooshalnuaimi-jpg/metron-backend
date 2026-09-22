# METRON backend

Ingestion → storage → API → interface, on free tiers. Every market figure is stored with source, timestamp and status
(LIVE / DELAYED / EOD / STALE / UNAVAILABLE). Nothing is fabricated: a provider that returns nothing leaves an honest gap.

```
metron-backend/
  supabase/migrations/0001_schema.sql   tables, roles (OWNER / MEMBER), row level security
  supabase/migrations/0002_seed.sql     instrument catalogue, providers, central banks (no prices seeded)
  supabase/functions/refresh/           scheduled ingestion (Deno edge function)
  supabase/functions/_shared/           adapters: US Treasury, FRED, Twelve Data, official RSS · status engine · snapshot assembler
  supabase/cron.sql                     pg_cron schedule (session hours + daily EOD)
  app/                                  Next.js 14: /desk (interface), /api/snapshot, /api/ask, /api/user, /api/refresh, /login
  app/public/metron.html                the METRON interface (reads /api/snapshot, syncs personal data to /api/user)
  .github/workflows/refresh.yml         optional second scheduler
```

## 0. GitHub (private repo, no command line needed)
1. Install GitHub Desktop (desktop.github.com) and sign in.
2. File → Add local repository → choose the unzipped `metron-backend` folder → "create a repository here" → Create.
3. Publish repository → keep **Keep this code private** ticked.
4. Later, in the repo on github.com: Settings → Secrets and variables → Actions → add `METRON_SITE_URL` (your Vercel URL) and `METRON_REFRESH_SECRET`.

## 1. Supabase (free)
1. Create a project (region: Frankfurt or Mumbai; both fine from Dubai). Save the database password in a password manager. Project Settings → API: note the Project URL, anon key and service role key.
2. SQL editor → run `supabase/migrations/0001_schema.sql`, then `0002_seed.sql`.
3. Authentication → Providers → Email: keep enabled. Authentication → Settings: **turn off "Allow new users to sign up"** (invite-only).
4. First sign-in without email templates: Authentication → Users → **Add user → Create new user** with your email and a password, tick Auto Confirm. The first user to sign in becomes OWNER automatically. (Invite and magic-link emails also work once the email templates point at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` / `magiclink`.)
5. Edge functions: install the Supabase CLI, then
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set METRON_REFRESH_SECRET=... FRED_API_KEY=... TWELVEDATA_API_KEY=...
   supabase functions deploy refresh --no-verify-jwt
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
6. First run: `curl -X POST https://YOUR-PROJECT-REF.supabase.co/functions/v1/refresh -H "x-metron-secret: YOUR-SECRET"` → returns per-provider counts.
7. Schedule: edit the two placeholders in `supabase/cron.sql` and run it in the SQL editor.

## 2. Keys (free)
- FRED: https://fred.stlouisfed.org/docs/api/api_key.html
- Twelve Data: https://twelvedata.com (free plan: 800 credits/day, 8 requests/minute; some indices and commodities are not on the free plan and simply stay UNAVAILABLE)
- No Reuters, Bloomberg or exchange licences are needed; those rows stay NOT CONNECTED by design.

## 3. Vercel (free)
1. Push this folder to a private GitHub repo. In Vercel, import the repo with **Root Directory = `app`**.
2. Environment variables (copy from `app/.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `METRON_REFRESH_SECRET`,
   `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` (your vercel.app URL), and for Ask METRON `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`.
3. Deploy. Copy the deployment URL, add it as `NEXT_PUBLIC_SITE_URL`, redeploy. In Supabase → Authentication → URL Configuration set Site URL to that URL and add `https://<your-app>.vercel.app/auth/callback` and `/auth/confirm` as redirect URLs.
4. Open `/login`, sign in with the user you created, land on `/desk`. Data Providers should show CONNECTED for Treasury and, with keys, FRED and Twelve Data.
5. `vercel.json` adds a daily cron (03:30 UTC) as a backstop; the primary schedule is pg_cron in Supabase.

## 4. What each part does
- **Refresh function**: runs the adapters in parallel, upserts observations / series / curves / wire, updates provider status,
  then assembles the page snapshot from *everything stored* (so a provider outage keeps last good rows, marked STALE by the status engine).
- **/api/snapshot**: latest snapshot for a signed-in member. **/api/user**: watchlist, holdings, paper positions, journal, learning progress.
- **/api/ask**: Anthropic Messages API, server side, with the stored snapshot as the only context (80 questions per member per day).
- **/desk**: serves `public/metron.html` only to signed-in members. The page detects the server, loads the snapshot, syncs personal state,
  and routes Ask METRON through the server. Published as a Claude artifact instead, the same file reads the artifact database.

## 5. Approvals and costs
- Free: Supabase, Vercel, GitHub, FRED key, Twelve Data free plan.
- The only usage-based cost is `ANTHROPIC_API_KEY` for server-side Ask METRON and briefs. Leave it unset and the page falls back to its snapshot answers.
- Secrets live only in the Supabase and Vercel dashboards. Never paste them into chat, code or the page.

## 6. Next
- Brief generator (scheduled edge function: morning / afternoon / evening / weekly into `briefs`).
- GCC exchange adapter once a licensed or official feed is available.
- Calendar provider for consensus figures (stays UNAVAILABLE until then).
