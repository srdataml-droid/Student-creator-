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

-- CI-only session fixtures. No equivalent trigger is deployed to Supabase.
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,not_after timestamptz);
create function auth.ci_session_fixture() returns trigger language plpgsql as $$
begin insert into auth.sessions(id,user_id) values(new.id,new.id);return new;end $$;
create trigger ci_auth_session_fixture after insert on auth.users for each row execute function auth.ci_session_fixture();
create function auth.jwt() returns jsonb language sql stable as $$
 select jsonb_build_object('sub',auth.uid(),'session_id',coalesce(current_setting('request.jwt.claim.session_id',true),auth.uid()::text));
$$;
