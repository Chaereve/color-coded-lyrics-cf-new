# Database inventory — reference, KHÔNG phải live production

Nguồn: `supabase/schema.sql`, migrations 20261112–20261120 và fingerprint `supabase/baselines/20261120.json`. Ngày trong filename là ID lịch sử repo (có ID sau ngày audit 2026-10-05), không phải bằng chứng đã deploy. Baseline PG18 có tên NOT NULL constraint khác PG17; phải đối chiếu catalog thật trước cleanup.

## Object actions / safety

| Object | Mục đích | Production dùng? | Cách thay/xoá | Rủi ro | Rollback |
|---|---|---|---|---|---|
| daily_quiz_answers | Ledger +1/đáp án, idempotency | runtime RPC source; live chưa xác minh | PR3 export, retention approval, DROP RESTRICT cuối chu kỳ | Mất financial audit | Restore data+DDL từ backup vào staging rồi selective restore, KHÔNG cộng vote lại |
| daily_quiz_attempts | Frozen questions/answers + progress | như trên | PR3 sau answers | FK answers, lost paid attempts | Restore attempts trước answers |
| daily_quiz_seen | Cooldown 90 ngày | như trên | PR3 sau helpers | Sai pool nếu rollback thiếu history | Restore nguyên ledger |
| daily_quiz_questions | Answer keys + bank metadata | như trên | PR3 sau RPCs; self FK duplicate_of | Lộ đáp án trong export; mất QA | Restore bảng + generated column/constraint/index |
| daily_quiz_config | Flags/quota/quality + free votes | cast_vote cũng phụ thuộc; live chưa xác minh | PR1/2 tách vote; PR3 xoá sau helpers | Hỏng tất cả vote | Restore config + helpers + voter definitions đồng bộ |
| daily_login_rewards | Calendar ledger cũ, reward 0 hoặc legacy 2 | claim_daily_login, payload, month RPC; live chưa xác minh | **GIỮ** immutable; không sửa history. Ledger paid mới riêng | Rewrite lịch sử; double grant ngày chuyển đổi | Không cần data rollback; giữ trigger no_vote |
| profiles.vote_credits / bonus_credits | Purchased / bonus wallet | shared vote/spin/login legacy | **GIỮ**, chỉ atomic +bonus ở RPC mới | Lost update; hoàn nhầm purchased | Tắt grant, reconcile qua audit, không trừ đồng loạt |
| activity_days; achievement_definitions; achievement_rewards; votes | Shared activity/reward/vote accounting | shared runtime; live chưa xác minh | **GIỮ**, kiểm tra indirect grants | Double reward/đổi semantics streak | Forward fix, không replay historical grants |

Tất cả 6 bảng daily bên dưới: RLS bật, không browser policy, REVOKE ALL FROM public/anon/authenticated, GRANT ALL TO service_role theo migrations. Không cho client REST select trực tiếp (đặc biệt đáp án/snapshot). Grants/owner live phải export; baseline không lưu đầy đủ ACL. Không có view quiz được khai báo. Không có sequence daily riêng (UUID/text/composite keys).

## Columns / constraints / indexes / policies / triggers (đầy đủ theo reference)


### public.daily_login_rewards

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `created_at` | `timestamp with time zone` | True | `now()`  |
| `reward` | `integer` | True | `0`  |
| `reward_day` | `date` | True | `—`  |
| `user_id` | `uuid` | True | `—`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_login_rewards_pkey`: `PRIMARY KEY (user_id, reward_day)`
- `daily_login_rewards_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

Indexes:
- `daily_login_rewards_pkey`: `CREATE UNIQUE INDEX daily_login_rewards_pkey ON public.daily_login_rewards USING btree (user_id, reward_day)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[{"name": "daily_login_rewards_no_vote", "definition": "CREATE TRIGGER daily_login_rewards_no_vote BEFORE INSERT OR UPDATE OF reward ON public.daily_login_rewards FOR EACH ROW EXECUTE FUNCTION daily_login_rewards_no_vote()"}]`.

### public.daily_quiz_answers

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `answered_at` | `timestamp with time zone` | True | `clock_timestamp()`  |
| `attempt_id` | `uuid` | True | `—`  |
| `awarded` | `integer` | True | `0`  |
| `correct` | `boolean` | True | `—`  |
| `option_id` | `text` | True | `—`  |
| `question_id` | `text` | True | `—`  |
| `quiz_date` | `date` | True | `—`  |
| `user_id` | `uuid` | True | `—`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_quiz_answers_attempt_id_fkey`: `FOREIGN KEY (attempt_id) REFERENCES daily_quiz_attempts(id) ON DELETE CASCADE`
- `daily_quiz_answers_awarded_check`: `CHECK ((awarded = ANY (ARRAY[0, 1])))`
- `daily_quiz_answers_pkey`: `PRIMARY KEY (user_id, quiz_date, question_id)`
- `daily_quiz_answers_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

Indexes:
- `daily_quiz_answers_day_idx`: `CREATE INDEX daily_quiz_answers_day_idx ON public.daily_quiz_answers USING btree (user_id, quiz_date)`
- `daily_quiz_answers_pkey`: `CREATE UNIQUE INDEX daily_quiz_answers_pkey ON public.daily_quiz_answers USING btree (user_id, quiz_date, question_id)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[]`.

### public.daily_quiz_attempts

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `answers` | `integer[]` | False | `—`  |
| `completed_at` | `timestamp with time zone` | False | `—`  |
| `created_at` | `timestamp with time zone` | True | `now()`  |
| `id` | `uuid` | True | `gen_random_uuid()`  |
| `locked` | `boolean` | True | `false`  |
| `max_votes` | `integer` | True | `5`  |
| `question_count` | `integer` | True | `5`  |
| `questions` | `jsonb` | True | `—`  |
| `quiz_date` | `date` | False | `—`  |
| `quiz_day` | `date` | True | `—`  |
| `score` | `integer` | False | `—`  |
| `selection` | `jsonb` | True | `'{}'::jsonb`  |
| `submitted_at` | `timestamp with time zone` | False | `—`  |
| `user_id` | `uuid` | True | `—`  |
| `votes_awarded` | `integer` | True | `0`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_quiz_attempts_max_votes_check`: `CHECK (((max_votes >= 1) AND (max_votes <= 5)))`
- `daily_quiz_attempts_pkey`: `PRIMARY KEY (id)`
- `daily_quiz_attempts_question_count_check`: `CHECK ((question_count = ANY (ARRAY[3, 5])))`
- `daily_quiz_attempts_questions_check`: `CHECK (((jsonb_typeof(questions) = 'array'::text) AND (jsonb_array_length(questions) = ANY (ARRAY[3, 5]))))`
- `daily_quiz_attempts_score_check`: `CHECK (((score IS NULL) OR ((score >= 0) AND (score <= 5))))`
- `daily_quiz_attempts_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- `daily_quiz_attempts_user_id_quiz_day_key`: `UNIQUE (user_id, quiz_day)`
- `daily_quiz_attempts_votes_awarded_check`: `CHECK (((votes_awarded >= 0) AND (votes_awarded <= 5)))`
- `daily_quiz_completion`: `CHECK ((((question_count = 5) AND (answers IS NULL) AND (score IS NULL) AND (completed_at IS NULL) AND (((submitted_at IS NULL) AND (NOT locked)) OR ((submitted_at IS NOT NULL) AND locked))) OR ((question_count = 3) AND (((completed_at IS NULL) AND (answers IS NULL) AND (score IS NULL)) OR ((completed_at IS NOT NULL) AND (answers IS NOT NULL) AND (score IS NOT NULL) AND (cardinality(answers) = 3))))))`

Indexes:
- `daily_quiz_attempts_pkey`: `CREATE UNIQUE INDEX daily_quiz_attempts_pkey ON public.daily_quiz_attempts USING btree (id)`
- `daily_quiz_attempts_user_id_quiz_day_key`: `CREATE UNIQUE INDEX daily_quiz_attempts_user_id_quiz_day_key ON public.daily_quiz_attempts USING btree (user_id, quiz_day)`
- `daily_quiz_attempts_user_quiz_date_idx`: `CREATE UNIQUE INDEX daily_quiz_attempts_user_quiz_date_idx ON public.daily_quiz_attempts USING btree (user_id, quiz_date) WHERE (quiz_date IS NOT NULL)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[]`.

### public.daily_quiz_config

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `key` | `text` | True | `—`  |
| `updated_at` | `timestamp with time zone` | True | `now()`  |
| `value` | `jsonb` | True | `—`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_quiz_config_pkey`: `PRIMARY KEY (key)`

Indexes:
- `daily_quiz_config_pkey`: `CREATE UNIQUE INDEX daily_quiz_config_pkey ON public.daily_quiz_config USING btree (key)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[]`.

### public.daily_quiz_questions

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `active` | `boolean` | True | `true`  |
| `approval_status` | `text` | True | `'draft'::text`  |
| `artist` | `text` | False | `—`  |
| `category` | `text` | True | `'Songs'::text`  |
| `copyright_flags` | `text[]` | True | `'{}'::text[]`  |
| `correct_option` | `integer` | True | `—`  |
| `correct_option_id` | `text` | False | `option_ids[(correct_option + 1)]` generated: s |
| `daily_eligibility_status` | `text` | True | `'ineligible'::text`  |
| `difficulty` | `text` | True | `'easy'::text`  |
| `duplicate_of` | `text` | False | `—`  |
| `explanation` | `text` | True | `—`  |
| `fact_key` | `text` | False | `—`  |
| `id` | `text` | True | `—`  |
| `option_ids` | `text[]` | True | `ARRAY['opt-a'::text, 'opt-b'::text, 'opt-c'::text, 'opt-d'::text]`  |
| `options` | `jsonb` | True | `—`  |
| `prompt` | `text` | True | `—`  |
| `quality_score` | `integer` | False | `—`  |
| `question_type` | `text` | True | `'mcq'::text`  |
| `retirement_status` | `text` | True | `'active'::text`  |
| `safety_flags` | `text[]` | True | `'{}'::text[]`  |
| `song_key` | `text` | False | `—`  |
| `source_access_status` | `text` | False | `—`  |
| `source_fact_match` | `text` | False | `—`  |
| `source_final_http_status` | `text` | False | `—`  |
| `source_final_url` | `text` | False | `—`  |
| `source_initial_http_status` | `text` | False | `—`  |
| `source_last_checked` | `date` | False | `—`  |
| `source_redirect_count` | `text` | False | `—`  |
| `source_url` | `text` | False | `—`  |
| `sub_category` | `text` | True | `'profile'::text`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_quiz_questions_approval_check`: `CHECK ((approval_status = ANY (ARRAY['draft'::text, 'pending_verification'::text, 'approved'::text, 'rejected'::text])))`
- `daily_quiz_questions_correct_option_check`: `CHECK (((correct_option >= 0) AND (correct_option <= 3)))`
- `daily_quiz_questions_difficulty_check`: `CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])))`
- `daily_quiz_questions_duplicate_of_fkey`: `FOREIGN KEY (duplicate_of) REFERENCES daily_quiz_questions(id)`
- `daily_quiz_questions_eligibility_check`: `CHECK ((daily_eligibility_status = ANY (ARRAY['eligible'::text, 'temporarily_ineligible'::text, 'ineligible'::text])))`
- `daily_quiz_questions_option_ids_check`: `CHECK (((cardinality(option_ids) = 4) AND (option_ids[1] <> option_ids[2]) AND (option_ids[1] <> option_ids[3]) AND (option_ids[1] <> option_ids[4]) AND (option_ids[2] <> option_ids[3]) AND (option_ids[2] <> option_ids[4]) AND (option_ids[3] <> option_ids[4])))`
- `daily_quiz_questions_options_check`: `CHECK (((jsonb_typeof(options) = 'array'::text) AND (jsonb_array_length(options) = 4)))`
- `daily_quiz_questions_pkey`: `PRIMARY KEY (id)`
- `daily_quiz_questions_quality_check`: `CHECK (((quality_score IS NULL) OR ((quality_score >= 0) AND (quality_score <= 100))))`
- `daily_quiz_questions_question_type_check`: `CHECK ((question_type = ANY (ARRAY['mcq'::text, 'true_false'::text])))`
- `daily_quiz_questions_retirement_check`: `CHECK ((retirement_status = ANY (ARRAY['active'::text, 'review_required'::text, 'retired'::text, 'superseded'::text])))`
- `daily_quiz_questions_sub_category_check`: `CHECK ((sub_category = ANY (ARRAY['profile'::text, 'lyrics'::text, 'lyrics_keyword'::text])))`

Indexes:
- `daily_quiz_questions_pkey`: `CREATE UNIQUE INDEX daily_quiz_questions_pkey ON public.daily_quiz_questions USING btree (id)`
- `daily_quiz_questions_pool_idx`: `CREATE INDEX daily_quiz_questions_pool_idx ON public.daily_quiz_questions USING btree (difficulty, artist) WHERE ((approval_status = 'approved'::text) AND (daily_eligibility_status = 'eligible'::text) AND (retirement_status = 'active'::text) AND active)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[]`.

### public.daily_quiz_seen

| Column | Type | NOT NULL | Default / generated |
|---|---|---|---|
| `last_seen` | `date` | True | `—`  |
| `question_id` | `text` | True | `—`  |
| `user_id` | `uuid` | True | `—`  |

Constraints (NOT NULL đã ghi ở bảng columns):
- `daily_quiz_seen_pkey`: `PRIMARY KEY (user_id, question_id)`
- `daily_quiz_seen_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`

Indexes:
- `daily_quiz_seen_pkey`: `CREATE UNIQUE INDEX daily_quiz_seen_pkey ON public.daily_quiz_seen USING btree (user_id, question_id)`
- `daily_quiz_seen_recent_idx`: `CREATE INDEX daily_quiz_seen_recent_idx ON public.daily_quiz_seen USING btree (user_id, last_seen)`

RLS=True; FORCE RLS=False; policies: `[]`.

Triggers: `[]`.

## Function inventory (mọi daily_quiz_*, daily_rewards_* + entrypoints/shared dependencies)

| Signature / purpose | Quyền source | Production / xử lý | Rủi ro / rollback |
|---|---|---|---|
| `public.cast_vote(p_request_id uuid, p_delta integer, p_fp_hash text, p_ip_hash text, p_gate_token text)` → `TABLE(votes integer, my_votes integer, free_used integer, credits integer)`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; GIỮ/tách quiz implementation; không drop shared voting | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.claim_daily_login(p_expected_user_id uuid, p_expected_day date)` → `jsonb`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; GIỮ history/trigger; retire writer hoặc compatibility guard sau cutover | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_free_vote_grant(p_uid uuid, p_day date)` → `integer`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; GIỮ/tách quiz implementation; không drop shared voting | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_login_rewards_no_vote()` → `trigger`, SD=False | Trigger only (not a normal REST RPC); review ACL live | Live chưa xác minh; GIỮ history/trigger; retire writer hoặc compatibility guard sau cutover | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_bool(p_key text, p_default boolean)` → `boolean`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_candidates(p_uid uuid, p_day date)` → `TABLE(id text, prompt text, options jsonb, option_ids text[], correct_option integer, correct_option_id text, explanation text, category text, difficulty text, sub_category text, question_type text, artist text, fact_key text, song_key text, seen_recently boolean)`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_int(p_key text, p_default integer)` → `integer`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_mix(p_pool jsonb)` → `TABLE(need_easy integer, need_medium integer, need_hard integer)`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_num(p_key text)` → `double precision`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_pick(p_uid uuid, p_day date, p_need_easy integer, p_need_medium integer, p_need_hard integer, p_unseen_only boolean, p_min_artists integer, p_require_profile boolean, p_require_lyrics boolean, p_attempts integer)` → `TABLE(question_id text)`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_pool(p_uid uuid, p_day date)` → `jsonb`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_quiz_votes_on(p_uid uuid, p_day date)` → `integer`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.daily_rewards_payload(p_uid uuid, p_now timestamp with time zone)` → `jsonb`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.my_daily_checkin_month(p_month date)` → `jsonb`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; GIỮ history/trigger; retire writer hoặc compatibility guard sau cutover | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.my_daily_rewards_status()` → `jsonb`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.my_vote_status()` → `TABLE(free_used integer, free_limit integer, credits integer, purchased integer, bonus integer)`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; GIỮ/tách quiz implementation; không drop shared voting | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)` → `jsonb`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.submit_daily_quiz(p_expected_user_id uuid, p_attempt_id uuid, p_answers integer[])` → `jsonb`, SD=True | Internal/retired; client EXECUTE revoked | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |
| `public.submit_daily_quiz_answer(p_expected_user_id uuid, p_attempt_id uuid, p_question_id text, p_option_id text)` → `jsonb`, SD=True | authenticated EXECUTE; check auth.uid() | Live chưa xác minh; PR3 drop sau dependency removal | Caller fail nếu sai thứ tự; restore exact definition + owner + ACL (không chỉ CREATE OR REPLACE) |

### Mục đích từng function / entrypoint

| Function | Mục đích hiện tại theo source |
|---|---|
| daily_quiz_int / daily_quiz_bool / daily_quiz_num | Đọc typed config integer/boolean/float, helper riêng tư |
| daily_quiz_candidates | Lọc bank theo approval, source quality/freshness, safety và lịch sử seen |
| daily_quiz_pool | Tổng hợp pool đủ điều kiện theo độ khó |
| daily_quiz_mix | Xác định số câu easy/medium/hard theo config và pool |
| daily_quiz_pick | Chọn bộ câu hỏi theo mix, diversity/artist/category và cooldown |
| daily_quiz_votes_on | Đếm các answer thực sự awarded=1 trong ngày |
| daily_rewards_payload | Response chung login history + quiz state/sanitized questions + balances |
| my_daily_rewards_status | Entry authenticated gọi payload của chính auth.uid() |
| claim_daily_login | Ghi check-in không thưởng trong policy cuối, replay-safe, trả payload chung |
| daily_login_rewards_no_vote | Trigger cấm new nonzero reward và sửa amount lịch sử |
| my_daily_checkin_month | Owner-only lịch sử check-in theo tháng |
| start_daily_quiz | Tạo/replay frozen attempt và cập nhật seen history |
| submit_daily_quiz_answer | Grade per answer, atomic +bonus wallet, cap5, lock/finalize attempt |
| submit_daily_quiz | Legacy bulk-submit retired, luôn raise err.dailyQuizRetired |
| daily_free_vote_grant | Chính sách free automatic quota, phụ thuộc quiz flags/cap; hiện default0 |
| my_vote_status | Free used/limit và purchased/bonus balance cho caller |
| cast_vote | Cast/refund votes, shared wallet locking, anti-fraud và Edge gate |

### Config keys (tất cả server-side quiz flags hiện có)

```json
{
  "daily_vote_cap": "5",
  "easy_count": "2",
  "free_vote_grant_enabled": "false",
  "free_votes_per_day": "3",
  "freshness_days": "30",
  "global_daily_vote_cap": "5",
  "global_daily_vote_cap_enabled": "false",
  "hard_count": "0",
  "hard_question_enabled": "false",
  "legacy_pool_enabled": "false",
  "max_hard_per_set": "1",
  "max_lyrics_keyword": "1",
  "max_per_artist": "2",
  "max_source_redirects": "3",
  "max_true_false": "1",
  "medium_count": "3",
  "min_distinct_artists": "3",
  "min_hard_pool_to_enable": "30",
  "min_lyrics": "1",
  "min_profile": "1",
  "min_quality_score": "97",
  "questions_per_day": "5",
  "repeat_cooldown_days": "90"
}
```

Không chuyển toàn bộ config quiz sang login. `free_vote_grant_enabled`, `free_votes_per_day`, `global_daily_vote_cap_enabled`, `global_daily_vote_cap` cần quyết định policy voting riêng: đề xuất free automatic grant=0, giữ bonus/purchased/spin/achievement không áp quiz cap 5. Không được tự bật +3 free grant vì xoá quiz config. **(Cập nhật sau này:** quyết định có review là **bật** 3 vote miễn phí/ngày bằng migration append-only `20261124_restore_daily_free_votes` — xem `docs/DAILY-REWARDS.md`; câu "không được tự bật" vẫn đúng nghĩa: chỉ bật bằng migration có review, không sửa seed/bundle và không đổi `global_daily_vote_cap_*`.**)**

## Dependency graph và thứ tự cleanup đề xuất

```
App login + quiz -> my_daily_rewards_status -> daily_rewards_payload
claim_daily_login ---------------------------> daily_rewards_payload
start_daily_quiz -> pick / mix / pool / candidates -> config + questions + seen
submit_daily_quiz_answer -> answers + attempts + profiles + activity_days + payload
payload -> pool / mix / config + attempts + answers + daily_login_rewards + profiles
cast_vote / my_vote_status -> daily_free_vote_grant -> config readers + daily_quiz_votes_on -> answers
my_daily_checkin_month -> daily_login_rewards (GIỮ legacy read)
daily_login_rewards trigger -> daily_login_rewards_no_vote (GIỮ)
answers FK -> attempts FK -> profiles (GIỮ profiles)
questions.duplicate_of FK -> questions (self)
```

1. PR1 additive backend/UI; PR2 retire writers server-side theo cutoff, không chỉ ẩn route. Tách `claim_daily_login`, `my_vote_status`, `cast_vote`, `daily_free_vote_grant` khỏi payload/config quiz; giữ anti-fraud/gate/refund/bonus reset/lock order hiện có.
2. Xác minh không còn runtime caller; legacy tabs nhận lỗi retired có hướng dẫn refresh, không payload lỗi/HTTP blank. Giữ tombstone entrypoints trong grace period trước PR3.
3. PR3 chỉ sau backup restore drill và duyệt riêng: drop entrypoints quiz + `my_daily_rewards_status`, rồi `daily_rewards_payload`; sau đó pick, mix, pool, candidates; `daily_quiz_votes_on`; cuối là typed config readers. Xác minh từng signature và `pg_depend` thực tế; không dùng CASCADE.
4. Drop tables: answers → attempts → seen → questions → config. Index/policy/constraint owned sẽ đi theo bảng; không cần drop trước. Không drop daily_login_rewards/trigger hoặc shared tables.
5. Kiểm tra PL/pgSQL/string SQL bằng tìm kiếm definitions nữa: `pg_depend` không đảm bảo bắt hết late-bound SQL. Nếu phát hiện object ngoài inventory: DỪNG và review lại, không dùng CASCADE chữa lỗi.
6. Migration history **không xoá/sửa**. Fresh-install cuối cùng phải phản ánh trạng thái không quiz; đường upgrade lịch sử vẫn tái lập được bằng fixtures được kiểm soát, không bật quiz ở production. Đổi schema splitter/baseline có review riêng cùng PR3.
