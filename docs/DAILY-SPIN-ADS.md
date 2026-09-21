# Daily Spin + quảng cáo thưởng: kết luận rà soát (21/09/2026)

## Kết luận ngắn

**Có thể thử về mặt kỹ thuật, nhưng chưa nên bật hoặc hứa thưởng chỉ vì client nhận
`onComplete`.** Bản kế hoạch hiện tại có một lỗ hổng chốt thưởng rất lớn: mọi JavaScript
chạy trên trình duyệt đều có thể bị gọi lại bằng DevTools, nên user có thể tự gọi
`/api/spin` mà không xem quảng cáo. `vote_balance` phải được cộng ở Worker/D1, nhưng
Worker phải nhận được một bằng chứng server-to-server hoặc một token thưởng có chữ ký
mà network quảng cáo phát hành — không được tin callback của browser.

Ngoài ra, việc "chỉ thưởng vote ảo" không tự động làm luồng hợp lệ với mọi ad network.
Đây vẫn là traffic có khuyến khích (incentivized traffic); cần nhà cung cấp xác nhận
bằng văn bản rằng format + GEO + phần thưởng của Chaereve được phép. Không đưa quảng cáo
vào production trước khi có câu trả lời đó.

## Các điểm trong kế hoạch cần sửa

| Điểm | Đánh giá | Cách làm an toàn hơn |
|---|---|---|
| Callback `onComplete` từ SDK | Không đủ để xác thực; client forge được | S2S/postback hoặc signed reward token; nếu network không có thì chỉ coi là UX, không cộng thưởng |
| `last_spin < today` | Dùng được nhưng hơi mỏng | Bảng `spin_claims(user_id, day)` với unique key `(user_id, day)`, hoặc một transaction `UPDATE ... WHERE` rồi kiểm tra `changes = 1` |
| D1 hay KV | D1 đúng cho claim một lần | KV eventual consistency không được dùng làm chốt chống double-claim; KV chỉ hợp cho cache/rate limit mềm |
| User ID từ frontend | Không tin được | Worker lấy user từ Supabase JWT/session, không nhận `user_id` tự do từ body |
| IP rate limit | Chỉ là lớp phụ | Kết hợp account + device/fingerprint + IP hash + nonce một lần; không coi IP là danh tính người |
| AdBlock | Không thể xác nhận chắc chắn | Nói "chưa nhận được reward verification"; không dùng câu khẳng định user phải tắt AdBlock, không loop popup |
| Free tier | Không phải "5M reads, 100k writes/tháng" | Cloudflare D1 hiện ghi Workers Free là **5 triệu rows read/ngày, 100.000 rows written/ngày, 5 GB storage**; writes bao gồm index rows và giới hạn reset theo ngày UTC [1](https://developers.cloudflare.com/d1/platform/pricing/). |
| Monetag / PropellerAds | Chưa đủ bằng chứng để chọn | Monetag mô tả Rewarded Interstitial/Popup trong tài liệu Mini Apps, không phải một web callback chung [2](https://help.monetag.com/en/articles/10206215-introduction-to-telegram-mini-apps/). PropellerAds có tài liệu S2S postback cho conversion tracking [3](https://help.propellerads.com/en/articles/1954809-how-to-integrate-propellerads-s2s-conversion-tracking), nhưng đó không chứng minh có rewarded-web completion callback cho use case này. |

D1 là lựa chọn hợp lý cho lượng nhỏ vì update/insert có thể atomic; giới hạn hiện tại
cần đọc đúng theo rows read/written, không đếm đơn giản theo số request. Một database
Free có giới hạn size 500 MB theo bảng limits hiện tại [4](https://developers.cloudflare.com/d1/platform/limits/).

## Luồng đề xuất trước khi code

1. Worker tạo `reward_attempt` với `attempt_id`, user từ JWT, day VN, expiry ngắn (ví dụ
   10 phút), trạng thái `started`; rate-limit trước khi gọi ad.
2. Frontend mở **đúng một** ad slot do network cung cấp. Không cộng vote, không quay kết
   quả ở bước này.
3. Network gọi postback HTTPS vào Worker với `attempt_id`/transaction id và chữ ký.
   Worker kiểm tra chữ ký, network, timestamp, campaign/placement, nonce chưa dùng.
4. Worker chạy transaction:
   - `INSERT INTO spin_claims(user_id, day, attempt_id) ... ON CONFLICT DO NOTHING`;
   - chỉ khi insert thành công mới random phần thưởng bằng nguồn server;
   - ghi ledger `vote_rewards` với `source = rewarded_ad`, amount, ad event id;
   - trả trạng thái cho frontend.
5. Frontend chỉ poll trạng thái attempt hoặc nhận response của Worker; không tự cộng
   `vote_balance`. Nút reload/retry chỉ đọc cùng attempt id và nhận cùng kết quả.
6. Nếu không có postback xác thực: cho user quay Daily Spin hiện tại, nhưng **không**
   gọi đó là "xem quảng cáo nhận vote"; hoặc tắt reward trên web.

## Schema tối thiểu đề xuất

```sql
create table spin_claims (
  user_id uuid not null,
  day text not null,                 -- VN day key, Worker tạo
  attempt_id text not null unique,
  ad_event_id text unique,
  created_at text not null,
  primary key (user_id, day)
);

create table vote_reward_ledger (
  id integer primary key autoincrement,
  user_id uuid not null,
  amount integer not null check (amount between 1 and 5),
  source text not null check (source = 'rewarded_ad'),
  ad_event_id text not null unique,
  created_at text not null
);
```

`vote_balance` có thể là số dư đọc nhanh, nhưng ledger mới là nguồn điều tra. Không nên
random ở browser, không nên để endpoint nhận `amount` từ body, và không nên chỉ lưu
`last_spin` vì không có idempotency key để truy vết callback lặp.

## Quyết định cho Chaereve

- **Chưa thêm SDK quảng cáo vào app trong vòng này.** Cần chọn network sau khi họ xác
  nhận rewarded web + callback/postback + incentivized virtual votes bằng văn bản.
- Giữ Daily Spin hiện tại không phụ thuộc ads; đây là fallback đúng sự thật khi ad block,
  fill thấp hoặc network không có reward verification.
- Nếu sau này có S2S: thêm Worker trước, bật D1 claim/ledger sau, rồi mới nối nút UI;
  không đảo thứ tự.
