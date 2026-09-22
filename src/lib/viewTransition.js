/* =========================================================
   CHUYỂN CẢNH GIỮA HAI MỤC — MỘT CỬA, VÀ CỬA ĐÓ PHẢI DỌN SẠCH
   ---------------------------------------------------------
   LỖI CHỦ DỰ ÁN BÁO (vòng 24): "bấm sang tab khác trong trang thì
   bị CHỒNG TRANG". Một phần ảnh chụp cho thấy hai trang nằm chồng
   lên nhau — và chuyển cảnh của trình duyệt (View Transitions) là
   thứ duy nhất trong app vẽ ẢNH CHỤP của trang cũ lên trên trang
   mới.

   View Transitions không tự sinh ra ảnh chụp nào để mà hỏng: nó
   chụp DOM tại hai thời điểm. Nên thứ duy nhất làm nó ra ảnh ghép
   sai là NHỮNG GÌ XẢY RA GIỮA HAI LẦN CHỤP:
     · một chuyến chuyển cảnh KHÁC đang bay (bấm hai mục liên tiếp
       trong lúc 0,4s của chuyến trước chưa xong): lần chụp thứ hai
       chụp luôn cả ẢNH của chuyến thứ nhất đang nằm trên màn hình →
       ảnh của ảnh, hai ba lớp trang chồng nhau;
     · đổi state React bên ngoài cửa sổ chụp, hoặc cuộn trang mượt
       chạy qua mốc chụp → trang cũ và trang mới lệch nhau về vị trí.

   Module này gom cả bốn luật vào một chỗ, và luật nào cũng là một
   lỗi đã gặp thật:
     1. Không có API (Firefox cũ, jsdom) → đổi thẳng, không chuyển cảnh.
     2. Người dùng xin GIẢM CHUYỂN ĐỘNG → đổi thẳng.
     3. ĐANG có chuyến bay → đổi thẳng, KHÔNG mở chuyến thứ hai. Chậm
        một nhịp còn hơn một tấm ảnh chụp lồng nhau không gỡ ra được.
     4. Xong, hỏng, hay bị bỏ (skipTransition) → LUÔN dọn: xoá
        `data-nav` và nhả cờ "đang bay". Không dọn thì cờ kẹt vĩnh
        viễn và từ đó mọi lần đổi mục đều là đổi thẳng — không ai
        biết vì sao hết chuyển cảnh.

   `data-nav` là hướng đi (`fwd`/`back`), CSS dùng nó để chọn chiều
   trượt; để lại sau khi chuyến xong là dạy sai cho chuyến sau.
   ========================================================= */

export function createSectionTransition({ doc = globalThis.document, reduced = () => false } = {}) {
  let inFlight = false

  /**
   * @param {'fwd'|'back'} direction hướng đi, dùng cho CSS
   * @param {() => void} change việc đổi state — phải ĐỒNG BỘ, và là thứ duy
   *        nhất được đụng vào DOM trong lúc chuyển cảnh
   * @returns {object|null} chuyến chuyển cảnh, hoặc null nếu đi thẳng
   */
  return function runSectionChange(direction, change) {
    const root = doc?.documentElement
    const clearNav = () => { if (root?.dataset) delete root.dataset.nav }

    if (typeof doc?.startViewTransition !== 'function' || reduced() || inFlight) {
      change()
      return null
    }

    inFlight = true
    if (root?.dataset) root.dataset.nav = direction === 'back' ? 'back' : 'fwd'

    let transition
    try {
      transition = doc.startViewTransition(change)
    } catch {
      /* API có nhưng chết (chế độ riêng tư, tài liệu đang bị thay): người dùng
         vẫn phải tới nơi, chỉ là không có chuyển cảnh. */
      inFlight = false
      clearNav()
      change()
      return null
    }

    const done = () => { inFlight = false; clearNav() }
    try { transition.finished.then(done, done) } catch { done() }
    return transition
  }
}
