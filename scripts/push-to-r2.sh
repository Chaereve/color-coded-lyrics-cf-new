#!/usr/bin/env bash
# =========================================================
# (TUỲ CHỌN) ĐẨY BẢN SAO LƯU LÊN CLOUDFLARE R2
# ---------------------------------------------------------
# Vì sao cần: artifact của GitHub Actions chỉ giữ tối đa 90 ngày, mà repo
# private còn tính vào 500 MB dung lượng miễn phí. R2 gói free cho 10 GB và
# KHÔNG tính phí băng thông ra — đúng chỗ để cất bản sao lưu dài hạn.
#
# Không cấu hình gì thì file này thoát ngay mà không báo lỗi: sao lưu vẫn chạy
# và artifact vẫn được giữ. Muốn bật, thêm 4 secret cho repo:
#   R2_BUCKET · R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY
# (R2 → Manage R2 API Tokens → tạo token có quyền Object Read & Write)
# =========================================================
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-backup}"

if [ -z "${R2_BUCKET:-}" ]; then
  echo "[r2] chưa cấu hình R2_BUCKET → bỏ qua (bản sao trong artifact của Actions vẫn còn)"
  exit 0
fi
[ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] \
  || { echo "[r2] thiếu R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "[r2] thiếu aws CLI" >&2; exit 1; }

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto          # R2 dùng "auto"; giá trị khác vẫn chạy nhưng đúng thì hơn
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
# Mỗi bản một thư mục riêng theo ngày: không bao giờ ghi đè bản cũ, nên một
# lần dump hỏng không xoá mất bản lành của hôm trước.
DEST="s3://${R2_BUCKET}/db/$(date -u +%Y-%m-%d_%H%M)/"

echo "[r2] đồng bộ $BACKUP_DIR → $DEST"
aws s3 sync --endpoint-url "$ENDPOINT" --no-progress "$BACKUP_DIR" "$DEST"
aws s3 ls --endpoint-url "$ENDPOINT" "s3://${R2_BUCKET}/db/" | tail -10
echo "[r2] xong. Đặt lifecycle rule trên bucket để tự xoá bản cũ (>90 ngày) nếu muốn."
