-- =========================================================
-- BỐI CẢNH GIẢ SUPABASE — chỉ dùng cho BƯỚC KIỂM TRA PHỤC HỒI
-- ---------------------------------------------------------
-- Bản dump của Supabase có nhắc tới những thứ mà một container Postgres
-- trơn không có: ba role `anon` / `authenticated` / `service_role` (mọi
-- GRANT và mọi policy RLS đều trỏ tới chúng), schema `auth` cùng các hàm
-- `auth.uid()` mà policy gọi, và extension `pgcrypto` mà Supabase đặt trong
-- schema `extensions`.
--
-- Không có file này thì phép thử phục hồi sẽ báo lỗi ở hàng loạt policy —
-- không phải vì bản dump hỏng, mà vì database đích thiếu ngữ cảnh. Mục đích
-- của phép thử là bắt được bản dump HỎNG, nên nó phải chạy trên một database
-- giống Supabase nhất có thể.
--
--   ⚠️  KHÔNG chạy file này trên project Supabase thật. Ở đó mọi thứ đã có
--       sẵn, và `create role` sẽ đụng vào role hệ thống.
-- =========================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;

do $$
begin
  create role anon nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role supabase_auth_admin nologin noinherit;
exception when duplicate_object then null;
end $$;

-- Chữ ký hàm phải khớp với cái mà policy trong dump gọi tới; thân hàm thì
-- không quan trọng — phép thử chỉ dựng schema rồi đếm, không gọi policy.
create or replace function auth.uid() returns uuid
  language sql stable as $fn$ select null::uuid $fn$;

create or replace function auth.role() returns text
  language sql stable as $fn$ select null::text $fn$;

create or replace function auth.email() returns text
  language sql stable as $fn$ select null::text $fn$;

create or replace function auth.jwt() returns jsonb
  language sql stable as $fn$ select '{}'::jsonb $fn$;
