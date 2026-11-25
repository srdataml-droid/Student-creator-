-- Disposable PostgreSQL CI harness only. NOT a Supabase replacement.
-- Recreates minimal Auth roles/schema expected by the proposed migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz,deleted_at timestamptz);
create table auth.sessions (id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
