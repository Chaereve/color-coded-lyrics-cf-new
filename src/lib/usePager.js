import { useMemo, useState } from 'react'

/* =========================================================
   PHÂN TRANG — một chỗ duy nhất cho mọi danh sách dài
   ---------------------------------------------------------
   Danh sách request / bảng xếp hạng / đơn hàng đều có thể dài hàng
   trăm dòng; cuộn tay để tìm một dòng là việc mệt và không có điểm
   dừng. Hook này cắt mảng đã sắp xếp sẵn thành từng trang.

   Điều đáng lưu ý duy nhất: SỐ TRANG PHẢI TỰ CO LẠI.
   Đang đứng ở trang 7, đổi bộ lọc còn 2 trang -> nếu giữ nguyên page
   thì màn hình trống trơn mà không ai hiểu vì sao. Effect bên dưới
   kéo page về trang cuối còn tồn tại.
   ========================================================= */
export function usePager(items, perPage = 20, deps = []) {
  const total = items.length
  const pages = Math.max(1, Math.ceil(total / perPage))

  /* `deps` gộp thành một khoá: bộ lọc / từ khoá / cách sắp xếp đổi là
     khoá đổi, và trang tự về 1. Làm bằng khoá thay vì useEffect(setPage)
     nên KHÔNG có nhịp render thừa nào vẽ ra trang cũ trên dữ liệu mới —
     đó chính là cái chớp một nhịp "hiện danh sách sai rồi mới nhảy". */
  const key = JSON.stringify(deps)
  const [st, setSt] = useState({ page: 1, key })

  /* Trang thật = trang đã lưu, nhưng luôn kẹp trong khoảng còn hợp lệ.
     Danh sách ngắn lại (xoá dòng, realtime đẩy về) mà đang đứng ở trang
     cuối thì tự lùi, không để lại một màn hình trống. */
  const page = st.key === key ? Math.min(Math.max(1, st.page), pages) : 1
  const setPage = (n) => setSt({ page: n, key })

  const slice = useMemo(
    () => (total <= perPage ? items : items.slice((page - 1) * perPage, page * perPage)),
    [items, page, perPage, total])

  return {
    page, pages, total, perPage,
    items: slice,
    from: total === 0 ? 0 : (page - 1) * perPage + 1,
    to: Math.min(page * perPage, total),
    setPage,
  }
}

/* Dãy số trang hiển thị: luôn có trang đầu, trang cuối, và một cửa sổ
   quanh trang hiện tại. Chỗ bị cắt trả về null để vẽ dấu "…".
   Danh sách 200 trang mà in ra 200 nút thì phân trang cũng vô nghĩa
   như cuộn tay. */
export function pageWindow(page, pages, span = 1) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const out = new Set([1, pages, page])
  for (let d = 1; d <= span; d++) { out.add(page - d); out.add(page + d) }
  /* hai đầu luôn đủ rộng để dãy số không nhảy chiều dài khi bấm qua lại */
  if (page <= 3) { out.add(2); out.add(3); out.add(4) }
  if (page >= pages - 2) { out.add(pages - 1); out.add(pages - 2); out.add(pages - 3) }

  const list = [...out].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  const withGaps = []
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) withGaps.push(null)
    withGaps.push(n)
  })
  return withGaps
}
