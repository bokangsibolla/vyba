-- Allow anon role full access to profiles (app handles auth via music service tokens)
create policy "anon_select_profiles" on public.profiles for select to anon using (true);
create policy "anon_insert_profiles" on public.profiles for insert to anon with check (true);
create policy "anon_update_profiles" on public.profiles for update to anon using (true);
create policy "anon_delete_profiles" on public.profiles for delete to anon using (true);

-- Allow anon role full access to connections
create policy "anon_select_connections" on public.connections for select to anon using (true);
create policy "anon_insert_connections" on public.connections for insert to anon with check (true);
create policy "anon_update_connections" on public.connections for update to anon using (true);
create policy "anon_delete_connections" on public.connections for delete to anon using (true);

-- Allow anon role full access to daily_issues
create policy "anon_select_daily_issues" on public.daily_issues for select to anon using (true);
create policy "anon_insert_daily_issues" on public.daily_issues for insert to anon with check (true);
create policy "anon_update_daily_issues" on public.daily_issues for update to anon using (true);
create policy "anon_delete_daily_issues" on public.daily_issues for delete to anon using (true);
