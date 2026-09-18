import { useEffect } from 'react'

/* =========================================================
   HIỆN DẦN KHI CUỘN TỚI
   ---------------------------------------------------------
   Gắn `data-reveal` vào khối nào muốn nó trượt nhẹ lên khi
   vừa lăn vào tầm nhìn. Class `in` được thêm đúng một lần,
   phần tử đã hiện rồi thì không nhảy lại khi dữ liệu tải về.

   Quét lại bằng MutationObserver chứ không chỉ theo deps:
   nội dung dựng SAU khi hook chạy (hết splash, dữ liệu mới
   về, đổi mục) vẫn được bắt — nếu không khối đó kẹt ở
   opacity 0 vì CSS [data-reveal] mặc định là ẩn.
   ========================================================= */
export function useReveal(_deps = []) {
  /* Chạy MỘT lần: MutationObserver tự bắt khối [data-reveal] dựng sau
     (hết splash, dữ liệu về, đổi mục). Truyền deps vào rồi hủy/tạo lại
     observer mỗi lần gõ tìm kiếm chỉ tốn frame mà không thêm gì. */
  useEffect(() => {
    const all = () => [...document.querySelectorAll('[data-reveal]:not(.in)')]

    /* trình duyệt cũ không có IntersectionObserver thì hiện luôn */
    if (!('IntersectionObserver' in window)) {
      all().forEach(el => el.classList.add('in'))
      return
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('in')
        io.unobserve(e.target)
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 })

    /* MutationObserver đã tự gộp mutation theo microtask, khỏi cần rAF:
       đợi frame thì có lúc khối nội dung vẫn kẹt ở opacity 0 */
    const scan = () => { all().forEach(el => io.observe(el)) }

    scan()
    const mo = new MutationObserver(scan)
    if (document.body) mo.observe(document.body, { childList: true, subtree: true })

    return () => { mo.disconnect(); io.disconnect() }
  }, [])
}
