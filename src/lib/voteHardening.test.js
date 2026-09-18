/* Kiểm thử "hợp đồng" cho đợt siết chống gian lận vote (2026-11-03).
   Không dựng được Postgres trong CI nên ta khoá bằng văn bản SQL: những lớp
   bảo vệ dưới đây từng bị bỏ quên đúng một lần rồi, và lần đó không có gì báo
   động. Mỗi assert ở đây tương ứng một lỗ hổng có thật trong
   docs/RA-SOAT-2026-09-08.md — xoá assert nào là mở lại lỗ hổng đó. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = f => readFileSync(new URL(`../../supabase/${f}`, import.meta.url), 'utf8')
const vote = read('migrations/20261103_vote_hardening.sql')
const hardening = read('migrations/20260906_rls_hardening.sql')
const schema = read('schema.sql')

test('cast_vote khoá hàng profiles trước khi đọc hạn mức (chống race)', () => {
  const body = vote.slice(vote.indexOf('create or replace function public.cast_vote'))
  const lock = body.indexOf('from public.profiles p where p.id = v_uid for update')
  const read1 = body.indexOf('into v_freeUsed from public.votes')
  assert.ok(lock > 0, 'phải khoá hàng profiles')
  assert.ok(read1 > lock, 'hạn mức chỉ được đọc SAU khi đã khoá')
})

test('hạn mức miễn phí nằm trong UNIQUE INDEX, không chỉ trong logic', () => {
  assert.match(vote, /create unique index if not exists votes_free_quota_idx/)
  assert.match(vote, /on public\.votes \(user_id, vote_day, free_slot\)/)
  // Cùng một vân tay = 3 vote miễn phí/ngày dù đổi bao nhiêu tài khoản.
  assert.match(vote, /create unique index if not exists votes_fp_free_quota_idx/)
  assert.match(vote, /on public\.votes \(fp_hash, vote_day, fp_slot\)/)
  assert.match(vote, /votes_free_slot_check[\s\S]*free_slot between 1 and 3/)
})

test('vote_day được backfill TRƯỚC khi đặt default', () => {
  // Thêm cột kèm default sẽ gán ngày hôm nay cho mọi dòng cũ và ăn mất hạn mức
  // free của người dùng đúng hôm chạy migration.
  const backfill = vote.indexOf("set vote_day = (created_at at time zone 'Asia/Ho_Chi_Minh')::date")
  const setDefault = vote.indexOf('alter column vote_day\n  set default')
  assert.ok(backfill > 0 && setDefault > backfill, 'backfill phải chạy trước set default')
  assert.ok(vote.indexOf('alter column vote_day set not null') > backfill)
})

test('rút vote hoàn về ĐÚNG ví, bonus không biến thành vote đã mua', () => {
  const body = vote.slice(vote.indexOf('create or replace function public.cast_vote'))
  assert.match(body, /credit_kind = 'bonus'/)
  assert.match(body, /bonus_credits = bonus_credits \+ coalesce\(v_refBonus, 0\)/)
  assert.match(body, /vote_credits\s+= vote_credits\s+\+ coalesce\(v_refPurch, 0\)/)
  // và lúc tiêu thì ghi rõ từng dòng tiêu ví nào
  assert.match(body, /then 'free'/)
  assert.match(body, /then 'bonus'/)
  assert.match(body, /else 'purchased' end/)
})

test('cổng Edge chặn được lời gọi thẳng PostgREST cho cả vote lẫn spin', () => {
  assert.match(vote, /create table if not exists public\.edge_gate/)
  assert.match(vote, /revoke all on public\.edge_gate from public, anon, authenticated/)
  assert.match(vote, /if not public\.edge_gate_ok\(p_gate_token\) then raise exception 'err\.voteGate'/)
  assert.match(vote, /if not public\.edge_gate_ok\(p_gate_token\) then raise exception 'err\.spinGate'/)
  // Cổng tắt (chưa đặt token) phải giữ nguyên hành vi cũ, không khoá ai cả.
  assert.match(vote, /if v_hash is null then return true; end if;/)
})

test('chữ ký hàm đổi thì phải bỏ bản cũ, tránh 300 ambiguous của PostgREST', () => {
  assert.match(vote, /drop function if exists public\.cast_vote\(uuid, int\);/)
  assert.match(vote, /drop function if exists public\.spin_daily\(text, uuid, uuid, text, text\);/)
  assert.match(vote, /grant execute on function public\.cast_vote\(uuid, int, text, text, text\) to authenticated/)
  assert.match(vote, /grant execute on function public\.spin_daily\(text, uuid, uuid, text, text, text\) to authenticated/)
})

test('admin_order chỉ xử lý đơn đang awaiting (bấm hai lần không cộng đôi)', () => {
  const body = vote.slice(vote.indexOf('create or replace function public.admin_order'))
  assert.match(body, /where id = p_order_id and status = 'awaiting'/)
  assert.match(body, /raise exception 'err\.orderLocked'/)
})

test('không xoá được request đã có vote của người khác; paid request bị chặn spam', () => {
  assert.match(vote, /raise exception 'err\.deleteVoted'/)
  assert.match(vote, /kind = 'paid_request' and status = 'awaiting'/)
  assert.match(vote, /raise exception 'err\.paidPending'/)
})

test('có hàm recount để dựng lại requests.votes sau khi dọn gian lận', () => {
  assert.match(vote, /create or replace function public\.recount_request_votes/)
  assert.match(vote, /grant execute on function public\.recount_request_votes\(\) to service_role/)
  assert.doesNotMatch(vote, /grant execute on function public\.recount_request_votes\(\) to authenticated/)
})

test('lỗi trả về là key i18n kèm số qua DETAIL, không phải câu tiếng Anh cứng', () => {
  assert.match(vote, /raise exception 'err\.rateLimit' using detail = '3'/)
  assert.match(vote, /raise exception 'err\.notEnoughVotes' using detail =/)
  assert.doesNotMatch(vote, /raise exception 'Not enough votes/)
  assert.doesNotMatch(vote, /raise exception 'Up to 3 requests per hour/)
  // và mọi key đó phải có trong từ điển, nếu không người dùng nhìn thấy 'err.x'
  const i18n = readFileSync(new URL('./i18n.jsx', import.meta.url), 'utf8')
  for (const key of ['err.rateLimit', 'err.notEnoughVotes', 'err.voteGate', 'err.voteFpLimit',
    'err.deleteVoted', 'err.paidPending', 'err.priceChanged', 'err.voteEdgeFp']) {
    assert.ok(i18n.includes(`'${key}':`), `thiếu key ${key} trong i18n`)
  }
})

test('schema.sql (bản cài mới) chứa nguyên văn cả hai đợt siết bảo mật', () => {
  // Đây chính là lỗi nặng nhất đợt rà soát: schema.sql tụt hậu so với
  // migrations, nên cài mới — hoặc chạy lại schema.sql "cho chắc" — là tự tay
  // mở lại buy_votes không kiểm giá, policy votes đọc công khai, và mất ràng
  // buộc vote_credits >= 0.
  assert.ok(schema.includes(hardening), 'schema.sql phải chứa 20260906_rls_hardening.sql')
  assert.ok(schema.includes(vote), 'schema.sql phải chứa 20261103_vote_hardening.sql')
  assert.ok(schema.indexOf(hardening) < schema.indexOf(vote), 'hardening chạy trước vote hardening')
})

test('bản cài mới không còn 4 điểm yếu mà migration 20260906 đã vá', () => {
  // Cắt phần đuôi đã append: những dòng cũ vẫn nằm trên đầu file (create table,
  // policy gốc…), điều quan trọng là LỆNH CUỐI CÙNG chạy phải là bản đã siết.
  const lastPolicy = schema.lastIndexOf('create policy "read own votes" on public.votes')
  const openPolicy = schema.lastIndexOf('create policy "read votes" on public.votes')
  assert.ok(lastPolicy > openPolicy, 'policy cuối cùng phải là "read own votes"')

  const priced = schema.lastIndexOf("raise exception 'err.priceChanged'")
  const buyVotes = schema.lastIndexOf('create or replace function public.buy_votes')
  assert.ok(priced > buyVotes, 'buy_votes chạy sau cùng phải là bản kiểm giá')

  assert.ok(schema.includes('add constraint profiles_credits_nonneg check (vote_credits >= 0)'))
  assert.match(schema, /revoke insert, update, delete on public\.requests from anon, authenticated/)
})
