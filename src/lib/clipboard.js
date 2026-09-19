/* =========================================================
   SAO CHÉP VÀO CLIPBOARD — có đường lùi
   ---------------------------------------------------------
   `navigator.clipboard` chỉ có trên HTTPS (và không có trong webview cũ).
   Ở app này nút sao chép có việc thật: nút chia sẻ bài, và nút "ghim công"
   của admin. Không có đường lùi thì trên máy không đủ điều kiện, cái nút
   ấy im lặng không làm gì — người dùng bấm lại ba lần rồi bỏ.
   Trả về true/false để nơi gọi nói được "đã copy" hay "không copy được".
   ========================================================= */

export async function copyText(text, doc = typeof document !== 'undefined' ? document : null) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text)
      return true
    }
  } catch { /* không có quyền hoặc không phải HTTPS: rơi xuống đường lùi */ }

  try {
    if (!doc?.body) return false
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    ta.remove()
    return !!ok
  } catch { return false }
}
