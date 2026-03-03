-- Enable pg_cron and pg_net extensions for scheduled HTTP calls
-- Note: These must be enabled in the Supabase dashboard first
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;

-- Schedule daily dig at 7:00 AM UTC
-- Run this in the Supabase SQL editor after enabling pg_cron:
--
-- select cron.schedule(
--   'daily-dig',
--   '0 7 * * *',
--   $$
--   select net.http_post(
--     url := '<SUPABASE_URL>/functions/v1/daily-dig',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- For now, document the setup steps:
comment on schema public is 'Daily dig cron: enable pg_cron and pg_net in dashboard, then schedule via SQL editor';
