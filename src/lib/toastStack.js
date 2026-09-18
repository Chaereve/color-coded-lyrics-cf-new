/* ============================================================
   CHỒNG TOAST — gộp mẩu trùng nhau và giữ cho chồng không che màn hình
   ------------------------------------------------------------
   Vì sao cần: một cú tick của admin trên cụm 3 request cùng bài có thể
   sinh ba lần CÙNG một dòng chữ ("Progress is at 40%"), mỗi lần một mẩu
   tin — người dùng thấy ba ô giống hệt nhau che mất góc màn hình trong khi
   nội dung chỉ có một. Gộp lại thành một mẩu có bộ đếm là đủ.
   Xem thêm: src/components/Toaster.jsx (nơi render bộ đếm).
   ============================================================ */

/* Tối đa số mẩu hiện cùng lúc. Mẫu cũ để 4 — bốn ô 8 giây là phủ gần hết
   khung nhìn trên màn 13". */
export const TOAST_CAP = 3

const sameText = (a, b) => a.tone === b.tone && a.title === b.title && a.body === b.body

/* Trả về danh sách MỚI (không sửa tại chỗ, React cần tham chiếu khác).
   - trùng văn bản với mẩu còn sống  -> làm mới mẩu đó: chạy lại đồng hồ,
     giữ nguyên vị trí và id (khỏi nhảy thứ tự, khỏi chạy animation lại),
     tang `repeat` de Toaster in "x3";
   - mẩu dang chay animation .out    -> KHONG gộp vào: nó sắp biến mất,
     mẩu mới phải hiện ra đầy đủ;
   - not trùng -> chen lên đầu, cắt theo `cap` (mẩu cũ nhất rơi xuống đất). */
export function mergeToast(list, item, cap = TOAST_CAP) {
  const rows = Array.isArray(list) ? list : []
  if (!item) return rows
  let merged = false
  const next = rows.map((n) => {
    if (merged || n.out || !sameText(n, item)) return n
    merged = true
    return {
      ...n,
      repeat: (n.repeat || 1) + 1,
      ms: item.ms ?? n.ms,
      action: item.action ?? n.action,
    }
  })
  if (merged) return next
  const keep = cap > 0 ? Math.max(0, cap - 1) : Math.max(0, rows.length)
  return [item, ...next.slice(0, keep)]
}
