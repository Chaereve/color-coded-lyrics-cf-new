import { pageWindow } from '../lib/usePager'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   THANH PHÂN TRANG
   ---------------------------------------------------------
   Dùng chung cho mọi danh sách dài. Ba phần:
     · bên trái  — đang xem dòng nào trên tổng bao nhiêu, để biết
                   danh sách còn dài đến đâu mà không phải đoán
     · ở giữa    — Trước / số trang / Sau
     · thu hẹp   — trên màn hẹp chỉ còn "3 / 12" giữa hai mũi tên,
                   dãy số dài không vừa một dòng mà xuống dòng thì
                   thanh này cao gấp ba lần cả một hàng dữ liệu

   `scrollTo`: bấm sang trang mới thì nội dung đổi hết, nhưng mắt vẫn
   đang ở cuối danh sách — luôn kéo về đầu khối cho khỏi lạc.
   ========================================================= */
export default function Pager({ page, pages, from, to, total, onChange, scrollTo }) {
  const { t } = useI18n()
  if (pages <= 1) return null

  const go = (n) => {
    const next = Math.max(1, Math.min(pages, n))
    if (next === page) return
    onChange(next)
    /* Khối danh sách trượt lên vừa đủ để hàng đầu tiên nằm trong tầm mắt.
       Phải tìm đúng thứ đang cuộn: ngoài trang chính là cả cửa sổ, còn
       trong modal thì cửa sổ đứng yên và chỉ .modal-body cuộn — cuộn nhầm
       cái nào thì bấm sang trang xong danh sách vẫn ở nguyên chỗ cũ. */
    const el = scrollTo?.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior = reduce ? 'auto' : 'smooth'

    /* bắt đầu từ chính el: có chỗ (bảng admin) truyền thẳng khung cuộn
       vào scrollTo, khi đó cuộn nó về 0 là đúng ý */
    let box = el
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY
      if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break
      box = box.parentElement
    }

    if (box && box !== document.body) {
      const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
      box.scrollTo({ top: Math.max(0, top), behavior })
    } else {
      const y = el.getBoundingClientRect().top + window.scrollY - 84
      window.scrollTo({ top: Math.max(0, y), behavior })
    }
  }

  return (
    <nav className="pager" aria-label={t('pager.label')}>
      <span className="pager-count">{t('pager.showing', { from, to, total })}</span>

      <div className="pager-ctrl">
        <button type="button" className="pager-btn" onClick={() => go(page - 1)}
          disabled={page === 1} aria-label={t('pager.prev')}>
          <Icon name="prev" size={14} />
          <span className="pager-btn-tx">{t('pager.prev')}</span>
        </button>

        <div className="pager-nums">
          {pageWindow(page, pages).map((n, i) => (
            n === null
              ? <span className="pager-gap" key={`g${i}`} aria-hidden="true">…</span>
              : (
                <button type="button" key={n} onClick={() => go(n)}
                  className={`pager-n${n === page ? ' on' : ''}`}
                  aria-current={n === page ? 'page' : undefined}
                  aria-label={t('pager.goTo', { n })}>
                  {n}
                </button>
              )
          ))}
        </div>

        {/* bản gọn cho màn hẹp */}
        <span className="pager-of">{page} / {pages}</span>

        <button type="button" className="pager-btn" onClick={() => go(page + 1)}
          disabled={page === pages} aria-label={t('pager.next')}>
          <span className="pager-btn-tx">{t('pager.next')}</span>
          <Icon name="next" size={14} />
        </button>
      </div>
    </nav>
  )
}
