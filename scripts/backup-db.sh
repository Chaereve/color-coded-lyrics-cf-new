#!/usr/bin/env bash
# =========================================================
# SAO LƯU DATABASE SUPABASE — chạy trong CI (GitHub Actions) hoặc bằng tay
# ---------------------------------------------------------
# Vì sao có file này: gói FREE của Supabase KHÔNG có backup tự động. Toàn bộ
# request, vote, đơn hàng, lịch sử vòng quay và ví lượt nằm ở ĐÚNG MỘT CHỖ —
# một câu `delete` gõ nhầm trong SQL Editor là mất, không có nút hoàn tác.
#
# Nguyên tắc của file này:
#   · CHỈ ĐỌC. Không một câu lệnh nào ở đây ghi vào database nguồn.
#   · Dump định dạng `custom` (nén sẵn, pg_restore chọn được từng phần khi
#     phục hồi, không phải chạy lại cả file).
#   · Xuất kèm "dấu vân tay" (số dòng từng bảng, số function/policy/trigger)
#     để bước kiểm tra phục hồi so được NGUỒN với BẢN PHỤC HỒI. Backup chưa
#     từng thử phục hồi thì chưa phải backup — chỉ là file nằm đó.
#
# Biến môi trường:
#   SUPABASE_DB_URL    (bắt buộc) chuỗi kết nối. Xem HUONG-DAN.md, mục
#                      "Sao lưu database" — phải là chuỗi **Session pooler**
#                      cổng 5432, không phải Direct connection.
#   BACKUP_DIR         thư mục ra (mặc định ./backup)
#   BACKUP_SCHEMAS     schema cần dump (mặc định public; ngăn bằng dấu phẩy)
#   BACKUP_AUTH_USERS  0 = bỏ qua bảng auth.users (mặc định 1)
# =========================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-backup}"
BACKUP_SCHEMAS="${BACKUP_SCHEMAS:-public}"
BACKUP_AUTH_USERS="${BACKUP_AUTH_USERS:-1}"
STAMP="$(date -u +%Y-%m-%d_%H%M)"
COMMIT="$(git -C "$HERE/.." rev-parse --short HEAD 2>/dev/null || echo unknown)"

die() { printf '\n[backup] LỖI: %s\n' "$*" >&2; exit 1; }

# Chuỗi kết nối có mật khẩu trong đó — không bao giờ in nguyên văn ra log.
mask() { sed -E 's#://[^@/]*@#://***@#' <<<"$1"; }

on_err() {
  local code=$?
  cat >&2 <<'MSG'

[backup] Không dump được. Bốn nguyên nhân, theo thứ tự hay gặp:
  1. Secret SUPABASE_DB_URL chưa đặt hoặc sai (GitHub → Settings → Secrets).
  2. Project Supabase đang NGỦ. Gói free tự tạm dừng sau 7 ngày không hoạt
     động; vào dashboard bấm khởi động lại rồi chạy lại workflow này.
  3. Chuỗi kết nối là "Direct connection" (db.<ref>.supabase.co). Địa chỉ đó
     chỉ có IPv6 mà runner của GitHub chỉ có IPv4 → không kết nối được. Lấy
     chuỗi "Session pooler" (cổng 5432) trong Supabase → Connect.
  4. pg_dump CŨ HƠN server (Supabase chạy Postgres 17). Workflow đã cài
     postgresql-client-17; nếu chạy tay thì cài client cùng phiên bản.
MSG
  exit "$code"
}
trap on_err ERR

[ -n "${SUPABASE_DB_URL:-}" ] || die "thiếu SUPABASE_DB_URL (chuỗi kết nối Session pooler, cổng 5432)"
for tool in pg_dump psql pg_restore; do
  command -v "$tool" >/dev/null 2>&1 || die "thiếu $tool — cài gói postgresql-client (bản 17) trước"
done

printf '[backup] nguồn: %s\n' "$(mask "$SUPABASE_DB_URL")"
printf '[backup] %s\n' "$(pg_dump --version)"

mkdir -p "$BACKUP_DIR"
# Chạy lại trên máy cá nhân thì dọn bản cũ trước, tránh lẫn dump của hai ngày.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name '*.dump' -o -name '*.sql' -o -name 'fingerprint*.txt' -o -name 'restore-warnings.txt' -o -name 'manifest.txt' \) \
  -delete 2>/dev/null || true

# `--schema` lặp lại được, nên "public,auth" phải tách thành hai tham số.
schema_args=()
IFS=', ' read -r -a schemas <<<"$BACKUP_SCHEMAS"
for s in "${schemas[@]}"; do [ -n "$s" ] && schema_args+=(--schema="$s"); done
[ "${#schema_args[@]}" -gt 0 ] || die "BACKUP_SCHEMAS rỗng"

DUMP="$BACKUP_DIR/ccl-$STAMP.dump"
printf '[backup] pg_dump → %s\n' "$DUMP"
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=9 --no-owner \
  "${schema_args[@]}" --file="$DUMP"

# Dump hỏng thường vẫn tạo ra file (đứt giữa đường) — phải đọc lại được bằng
# pg_restore và có object thật, nếu không thì đừng upload một file vô dụng.
[ -s "$DUMP" ] || die "file dump rỗng"
pg_restore --list "$DUMP" >/dev/null 2>&1 || die "file dump hỏng: pg_restore --list không đọc được"
objs="$(pg_restore --list "$DUMP" | grep -c ';' || true)"
[ "${objs:-0}" -gt 0 ] || die "dump không chứa object nào"
printf '[backup] %s object trong dump\n' "$objs"

# Bảng người dùng: KHÔNG nằm trong schema public nên phải dump riêng. Đây là
# lưới an toàn để đối chiếu (id + email khi dựng lại project), KHÔNG phải thứ
# phục hồi bằng một cú bấm — xem HUONG-DAN.md. Đọc không được thì bỏ qua chứ
# không làm hỏng cả lượt sao lưu: phần dữ liệu thật của app nằm ở public.
if [ "$BACKUP_AUTH_USERS" = "1" ]; then
  if pg_dump "$SUPABASE_DB_URL" --data-only --column-inserts \
       --table=auth.users --file="$BACKUP_DIR/auth-users.sql" 2>"$BACKUP_DIR/auth-users.err"; then
    rm -f "$BACKUP_DIR/auth-users.err"
    printf '[backup] auth.users → auth-users.sql (chỉ để đối chiếu)\n'
  else
    rm -f "$BACKUP_DIR/auth-users.sql"
    printf '[backup] CẢNH BÁO: không đọc được auth.users — bỏ qua, dữ liệu public vẫn nguyên\n' >&2
  fi
fi

# Dấu vân tay của nguồn — bước verify sẽ chạy ĐÚNG câu lệnh này trên bản phục
# hồi rồi so từng dòng.
FP="$BACKUP_DIR/fingerprint.txt"
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -A -t -f "$HERE/db-fingerprint.sql" >"$FP"
[ -s "$FP" ] || die "dấu vân tay rỗng — schema $BACKUP_SCHEMAS có tồn tại không?"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

{
  echo "created_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "app_commit: $COMMIT"
  echo "client: $(pg_dump --version)"
  echo "schema: $BACKUP_SCHEMAS"
  echo "objects: ${objs}"
  echo "tables: $(grep -c '^table|' "$FP" || true)"
  echo "functions: $(grep -c '^function|' "$FP" || true)"
  echo "policies: $(grep -c '^policy|' "$FP" || true)"
  echo "triggers: $(grep -c '^trigger|' "$FP" || true)"
  echo "indexes: $(grep -c '^index|' "$FP" || true)"
  echo "views: $(grep -c '^view|' "$FP" || true)"
  echo "rows_total: $(awk -F'|' '/^table\|/ {s += $3} END {print s + 0}' "$FP")"
  echo "files:"
  for f in "$BACKUP_DIR"/*; do
    [ -f "$f" ] || continue
    # Bỏ chính manifest ra khỏi danh sách: lúc này nó đang được ghi dở nên
    # băm nó chỉ ra một con số vô nghĩa — mà lại nằm ngay trong file.
    # (viết dạng `if` chứ không phải `[ … ] && continue`: `set -e` coi một
    #  dãy `&&` hỏng là lỗi và sẽ dừng cả script)
    if [ "$(basename "$f")" = "manifest.txt" ]; then continue; fi
    printf '  %s  %8s bytes  %s\n' "$(sha "$f")" "$(wc -c <"$f" | tr -d ' ')" "$(basename "$f")"
  done
} >"$BACKUP_DIR/manifest.txt"

printf '\n[backup] xong. Nội dung %s:\n' "$BACKUP_DIR"
cat "$BACKUP_DIR/manifest.txt"
