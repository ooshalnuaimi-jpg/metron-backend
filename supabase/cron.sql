-- METRON · scheduled refresh with pg_cron + pg_net (Supabase free tier).
-- Run in the SQL editor AFTER deploying the edge function and setting METRON_REFRESH_SECRET.
-- Replace the two placeholders. This SQL lives in your dashboard, not in the repo with real values.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 30 minutes, 06:00–22:00 GST on Monday–Friday (Dubai is UTC+4 → 02:00–18:00 UTC), plus a daily EOD pass at 01:15 GST.
select cron.unschedule(jobid) from cron.job where jobname in ('metron-refresh-session', 'metron-refresh-eod');

select cron.schedule('metron-refresh-session', '*/30 2-18 * * 1-5', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/refresh',
    headers := '{"Content-Type":"application/json","x-metron-secret":"YOUR-METRON-REFRESH-SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

select cron.schedule('metron-refresh-eod', '15 21 * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/refresh',
    headers := '{"Content-Type":"application/json","x-metron-secret":"YOUR-METRON-REFRESH-SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- Inspect runs: select * from cron.job_run_details order by start_time desc limit 20;
