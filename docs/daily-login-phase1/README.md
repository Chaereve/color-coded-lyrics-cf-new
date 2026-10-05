# Phase 1 — Daily Quiz → Daily Login Vote Rewards

**Trạng thái: audit + kế hoạch + mock, CHỜ REVIEW. Không triển khai Phase 2.**

Audit ngày **2026-10-05 UTC**, base commit `abad1bff1feb9126650fbc8b4c5289a68e61c1f6`.
Branch cố định: `arena/01a10bae-color-coded-lyrics-cf-new`.

## Phạm vi PR preview này

Chỉ thêm **7 file tài liệu/mock** dưới thư mục này. Không sửa/xoá source runtime, migrations, schema, RPC, routes, config, workflows, Cloudflare settings; không kết nối database production, không chạy SQL/migration/backup/import, không merge hoặc deploy production. Không xoá database dù để “dọn quiz”. Push branch/PR có thể kích hoạt CI/Cloudflare preview sẵn có; không thay cấu hình deployment hay gọi production deploy.

## 10 deliverables / đường dẫn

| # | Deliverable | Tài liệu |
|---|---|---|
| 1 | Inventory file/frontend/QA/config/jobs + production certainty + risk/rollback | [01-inventory.md](01-inventory.md) — **105 files** |
| 2 | Database objects, đầy đủ columns/indexes/constraints/RLS/function signatures, dependency graph | [02-database.md](02-database.md) |
| 3 | SQL backup/export, rollback templates, restore drill, production checklist | [03-backup-rollback.md](03-backup-rollback.md) |
| 4 | Server-side policy/schema/RPC/idempotency/atomicity/security | [04-design-rollout.md §1–3](04-design-rollout.md) |
| 5 | Calendar trước/sau + state preview | [calendar-preview.html](calendar-preview.html), UX spec trong design §4 |
| 6 | Migrations dự kiến và reversibility | Design §5; **chưa tạo executable SQL** |
| 7 | Files sẽ thay đổi từng PR | Design §6; file thực tế Phase1 là 7 file ở thư mục này |
| 8 | Kết quả audit baseline + backlog + acceptance test matrix | [05-audit-test-plan.md](05-audit-test-plan.md) |
| 9 | Supabase/secret/Cloudflare/cron/manual checklist | Design §8 + backup runbook |
| 10 | PR1 backend/UI; PR2 remove UI/retire writers; PR3 destructive cleanup riêng | Design §7 |

Mở mock trực tiếp trong trình duyệt hoặc static server thư mục này. HTML dùng dữ liệu mẫu cố định, CSP `connect-src 'none'`, không API/auth/storage, không cấp vote. Không phải phiên bản website đã sửa; Before là wireframe từ source, không ảnh production. Month controls disabled vì prototype chỉ minh hoạ tháng cố định; keyboard arrows/Home/End và status switch có thể thử.

## Kết luận quan trọng

1. **Không thể drop quiz ngay:** `cast_vote`/`my_vote_status` còn phụ thuộc `daily_free_vote_grant` → quiz config/answer ledger.
2. **Không đổi +0 thành +2 trong ledger cũ:** migration cuối cấm nonzero insert và sửa reward lịch sử. Đề xuất ledger paid mới, giữ nguyên audit cũ.
3. **Calendar đang dính quiz:** shared controller + validator + RPC payload. UI mới phải có contract riêng, không còn quiz import/network.
4. **Không thấy web admin Question Bank/quiz cron trong repo**; bank là CSV/tools/manual SQL + manual workflow. Objects/jobs ngoài repo chưa xác minh, không tự tuyên bố production không có.
5. Build PASS; **705 tests pass / 13 DB tests skipped**; smoke demo **420/420**; lint **29 warnings, 0 errors**; schema/migration static checks PASS. Không có typecheck script. Không tuyên bố production/E2E/RLS audit đã pass.
6. Workflow backup có run success và artifact metadata còn hạn, nhưng chưa tự download/restore. Cleanup bị chặn đến khi có backup mới + restore drill kiểm chứng dữ liệu và quyền.

## Xin owner chốt trước khi cho phép triển khai

- [ ] **Milestone đúng ngày** 3/7/14/30; ngày khác +2, sau30 không tự cycle/tier — hay bạn muốn policy khác?
- [ ] Reward streak mới bắt đầu từ claim chương trình mới; lịch sử cũ giữ và gắn legacy, **không trả bù** — hay carry-over cần design khác?
- [ ] Cutover ngày T tại **00:00 Asia/Ho_Chi_Minh**, không giữa ngày; retire quiz writers trước bật login.
- [ ] Giữ bonus expiry/reset hiện tại, automatic free grant=0; activity achievement độc lập (không gộp thưởng vào login receipt).
- [ ] Retention quiz financial audit + xử lý account deletion; đề xuất giữ archive ≥90 ngày, không tự xoá artifacts/migrations/history. Admin history UI hay DBA-only thời gian đầu?

**Duyệt Phase2/PR1 không tự động duyệt PR2, PR3, production deploy hoặc data deletion.** Mỗi bước cần signoff riêng; Phase1 dừng sau draft PR preview. Không tự “fix luôn” findings trong runtime ở turn này.

## Files mới thực tế

- `docs/daily-login-phase1/README.md`
- `docs/daily-login-phase1/01-inventory.md`
- `docs/daily-login-phase1/02-database.md`
- `docs/daily-login-phase1/03-backup-rollback.md`
- `docs/daily-login-phase1/04-design-rollout.md`
- `docs/daily-login-phase1/05-audit-test-plan.md`
- `docs/daily-login-phase1/calendar-preview.html`

Không có file ngoài danh sách trên trong patch dự kiến. Node dependencies/build output chỉ ở ignored paths, không commit. Log local chỉ dùng tóm tắt test, không chứa database dump.
