-- Disposable PostgreSQL CI harness only. NOT a Supabase replacement.
-- Recreates minimal Auth roles/schema expected by the proposed migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
