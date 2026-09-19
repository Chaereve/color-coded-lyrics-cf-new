#!/usr/bin/env bash
# =========================================================
# KIỂM TRA BẢN SAO LƯU — đổ thử vào một Postgres sạch rồi so dấu vân tay
# ---------------------------------------------------------
# Vì sao bước này tồn tại: một file `.dump` nằm trong thư mục trông rất giống
# một bản sao lưu, nhưng chỉ khi dựng lại được nó mới THẬT LÀ sao lưu. Hỏng
# thường gặp: dump cụt, thiếu policy, mất sequence, hoặc lỗi phiên bản client.
# Cả ba đều im lặng cho tới đúng ngày cần phục hồi.
#
# Cách làm: dựng đúng ngữ cảnh Supabase trên database đích (backup-stubs.sql),
# pg_restore toàn bộ, rồi chạy LẠI db-fingerprint.sql và so từng dòng với
# dấu vân tay lấy từ nguồn lúc dump. Lệch một dòng là fail.
#
# Biến môi trường:
#   VERIFY_DB_URL   (bắt buộc) chuỗi kết nối tới database SẠCH để thử
#   BACKUP_DIR      thư mục chứa bản dump (mặc định ./backup)
# =========================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-backup}"

die() { printf '\n[verify] LỖI: %s\n' "$*" >&2; exit 1; }

[ -n "${VERIFY_DB_URL:-}" ] || die "thiếu VERIFY_DB_URL — đây phải là database SẠCH, không phải database thật"
for tool in psql pg_restore; do
  command -v "$tool" >/dev/null 2>&1 || die "thiếu $tool — cài gói postgresql-client (bản 17) trước"
done

DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f | head -1 || true)"
[ -n "$DUMP" ] || die "không thấy file .dump nào trong $BACKUP_DIR"
SRC_FP="$BACKUP_DIR/fingerprint.txt"
[ -s "$SRC_FP" ] || die "thiếu $SRC_FP — bước dump chưa chạy xong"

# Database đích phải TRỐNG. Đổ chồng lên dữ liệu cũ thì COPY chèn trùng dòng
# và phép so báo lệch — trong khi bản dump hoàn toàn lành. Kiểm tra trước để
# thông báo lỗi nói đúng chuyện đang xảy ra.
existing="$(psql "$VERIFY_DB_URL" -X -q -A -t -c \
  "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$existing" = "0" ] || die "database đích đã có $existing bảng trong public — phải là database TRỐNG"

printf '[verify] dựng ngữ cảnh Supabase (role, auth, pgcrypto)\n'
psql "$VERIFY_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$HERE/backup-stubs.sql" >/dev/null

printf '[verify] pg_restore %s\n' "$DUMP"
rc=0
pg_restore --dbname="$VERIFY_DB_URL" --no-owner "$DUMP" 2>"$BACKUP_DIR/restore-warnings.txt" || rc=$?
# KHÔNG dùng --exit-on-error: trên database giống-Supabase nhưng không phải
# Supabase vẫn có lỗi lành tính (schema public đã tồn tại, comment...). Thứ
# quyết định là phép so dấu vân tay ở dưới, không phải mã trả về của pg_restore.
printf '[verify] pg_restore kết thúc với mã %s (không phải cổng chặn)\n' "$rc"

psql "$VERIFY_DB_URL" -X -q -A -t -f "$HERE/db-fingerprint.sql" >"$BACKUP_DIR/fingerprint-restored.txt"

if diff -u "$SRC_FP" "$BACKUP_DIR/fingerprint-restored.txt" >"$BACKUP_DIR/fingerprint.diff"; then
  rm -f "$BACKUP_DIR/fingerprint.diff"
  printf '[verify] OK — %s dòng dấu vân tay khớp hoàn toàn\n' "$(wc -l <"$SRC_FP" | tr -d ' ')"
else
  printf '\n[verify] LỆCH: bản phục hồi KHÁC nguồn. Đây là lỗi thật — đừng dựa vào bản dump này.\n' >&2
  head -40 "$BACKUP_DIR/fingerprint.diff" >&2
  printf '\n(xem đầy đủ: %s/fingerprint.diff)\n' "$BACKUP_DIR" >&2
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error::Bản dump không phục hồi khớp nguồn — xem fingerprint.diff trong artifact"
  fi
  exit 1
fi

# Lỗi lành tính vẫn nên hiện ra để còn soi khi cần, nhưng dưới dạng cảnh báo.
warn="$(grep -c '^pg_restore: error' "$BACKUP_DIR/restore-warnings.txt" || true)"
if [ "${warn:-0}" -gt 0 ]; then
  printf '[verify] %s cảnh báo từ pg_restore (dấu vân tay vẫn khớp):\n' "$warn"
  grep '^pg_restore: error' "$BACKUP_DIR/restore-warnings.txt" | sort -u | head -10
  # Kết thúc bằng `if` chứ không phải `[ … ] && echo`: ở cuối script, một dãy
  # `&&` hỏng sẽ thành MÃ THOÁT của cả script, và bước cảnh báo lành tính này
  # sẽ làm đỏ lượt sao lưu hoàn toàn bình thường.
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::warning::$warn cảnh báo pg_restore — xem restore-warnings.txt trong artifact"
  fi
fi
