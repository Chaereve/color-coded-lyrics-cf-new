-- =============================================================
-- IMPORT B1Q001 — Daily Quiz production pool (single record)
-- =============================================================
-- Nguồn chân lý      : data/kpop-quiz-bank/batch-01.csv (dòng B1Q001,
--                      đã approved/eligible, strict-production PASS).
-- Giá trị đo được    : question-bank live validation pilot
--                      (GitHub Actions run 37213399325, artifact
--                      question-bank-live-pilot-report-2), chủ bank
--                      xác nhận ngày 2026-10-04:
--                        HTTP 200, factMatch pass, redirectCount 0,
--                        temporaryRedirect false (nguồn chính
--                        sourcemusic.com); Genius 403 (secondary đã xóa).
-- Phạm vi            : CHỈ B1Q001. Không đụng B1Q009/B1Q010/B1Q019/B1Q022
--                      hay bất kỳ record nào khác.
-- Tính chất          : Idempotent — chạy lại sẽ chỉ cập nhật lại cùng giá trị.
--
-- Mapping đáng chú ý:
--   correct_option 'B'            -> 1 (A=0, B=1, C=2, D=3)
--   quality_score   112/115       -> 97/100 (chuẩn hóa sang thang DB;
--                                    pool yêu cầu >= 97)
--   sub_category    (CSV profile) -> 'profile' (check constraint DB)
--   category                      -> 'Groups' (chỉ để hiển thị, không có
--                                    constraint; nhất quán với taxonomy
--                                    demo: Songs/Lyrics/Groups/Members/Fandom)
--   option_ids / correct_option_id / active / safety_flags /
--   copyright_flags / duplicate_of -> dùng DEFAULT (opt-a..d; GENERATED;
--                                    true; '{}'; '{}'; NULL)
-- =============================================================

begin;

insert into public.daily_quiz_questions
  (id, prompt, options, correct_option, explanation, category, artist,
   difficulty, sub_category, question_type, fact_key, song_key,
   quality_score,
   approval_status, daily_eligibility_status, retirement_status,
   source_url, source_initial_http_status, source_final_http_status,
   source_final_url, source_redirect_count, source_access_status,
   source_fact_match, source_last_checked, active)
values
  ('B1Q001',
   'The group name LE SSERAFIM is an anagram of which English phrase?',
   '["I''M NOT AFRAID","I''M FEARLESS","WE ARE FEARLESS","FEARLESS FOREVER"]'::jsonb,
   1,
   'SOURCE MUSIC''s official artist profile states that the group name LE SSERAFIM is an anagram of I''M FEARLESS.',
   'Groups',
   'LE SSERAFIM',
   'easy', 'profile', 'mcq',
   'group_name_meaning:le-sserafim', null,
   97,
   'approved', 'eligible', 'active',
   'https://sourcemusic.com/artist/profile/LE%20SSERAFIM',
   '200', '200',
   'https://sourcemusic.com/artist/profile/LE%20SSERAFIM',
   '0', 'public_accessible', 'pass',
   date '2026-10-04',
   true)
on conflict (id) do update set
  prompt                     = excluded.prompt,
  options                    = excluded.options,
  correct_option             = excluded.correct_option,
  explanation                = excluded.explanation,
  category                   = excluded.category,
  artist                     = excluded.artist,
  difficulty                 = excluded.difficulty,
  sub_category               = excluded.sub_category,
  question_type              = excluded.question_type,
  fact_key                   = excluded.fact_key,
  song_key                   = excluded.song_key,
  quality_score              = excluded.quality_score,
  approval_status            = excluded.approval_status,
  daily_eligibility_status   = excluded.daily_eligibility_status,
  retirement_status          = excluded.retirement_status,
  source_url                 = excluded.source_url,
  source_initial_http_status = excluded.source_initial_http_status,
  source_final_http_status   = excluded.source_final_http_status,
  source_final_url           = excluded.source_final_url,
  source_redirect_count      = excluded.source_redirect_count,
  source_access_status       = excluded.source_access_status,
  source_fact_match          = excluded.source_fact_match,
  source_last_checked        = excluded.source_last_checked,
  active                     = excluded.active;

commit;

-- =============================================================
-- XÁC MINH SAU KHI CHẠY (read-only, dán riêng từng query)
-- =============================================================
-- 1. Hàng vừa ghi (đúng trạng thái quảng bá):
--    select id, approval_status, daily_eligibility_status, retirement_status,
--           quality_score, source_final_http_status, source_fact_match,
--           source_last_checked, active
--      from public.daily_quiz_questions where id = 'B1Q001';
--
-- 2. Pool Daily Quiz (đổi uuid thành user thật/bất kỳ):
--    select * from public.daily_quiz_pool(
--      '00000000-0000-0000-0000-000000000000'::uuid,
--      (now() at time zone 'Asia/Ho_Chi_Minh')::date);
--    Kỳ vọng: {"total":1,"easy":1,"medium":0,"hard":0}
--    (từ 0/0/0/0 trước khi import — quiz vẫn "not available"
--     cho tới khi pool đủ >= 2 easy + >= 3 medium.)
