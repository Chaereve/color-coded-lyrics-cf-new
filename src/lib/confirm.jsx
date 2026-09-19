import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

/* =========================================================
   `useConfirm()` — hỏi một câu, chờ một câu trả lời
   ---------------------------------------------------------
   Dùng ở nơi gọi:
       const ask = useConfirm()
       const r = await ask({ title: t('adm.confirmDelete'), body: t('dlg.cannotUndo') })
       if (!r) return                 // bấm Huỷ / Esc / bấm ra ngoài
       if (r.reason) …                // ô lý do, nếu hộp có hỏi

   Vì sao là Promise chứ không phải callback: chỗ gọi cũ đọc theo kiểu
   `if (!confirm(...)) return`, và giữ nguyên hình dạng đó thì việc thay hộp
   thoại không kéo theo việc viết lại luồng nghiệp vụ — chỗ dễ sinh lỗi nhất
   khi sửa một thứ dùng ở bảy nơi.

   Hộp thoại được dựng MỘT LẦN trong nhà cung cấp này, không phải mỗi nơi gọi
   một hộp: bảy bản sao của cùng một hộp là bảy chỗ để lệch nhau về phím tắt,
   về thứ tự nút, về cách đóng.
   ========================================================= */

const ConfirmCtx = createContext(null)

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null)      // { title, body, confirmLabel, tone, reasonLabel, reasonPh }
  const [reason, setReason] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const resolve = useRef(null)

  const ask = useCallback((opts) => new Promise((done) => {
    /* Nơi gọi cũ bị gọi hai lần (bấm nhanh hai cái) thì lần sau thắng — nhưng
       lần trước phải được trả lời, nếu không promise đó treo mãi và hàm gọi nó
       không bao giờ chạy tiếp. */
    resolve.current?.(null)
    resolve.current = done
    setReason('')
    setVideoUrl('')
    setReq(opts)
  }), [])

  const finish = useCallback((answer) => {
    const done = resolve.current
    resolve.current = null
    setReq(null)
    done?.(answer)
  }, [])

  const value = useMemo(() => ask, [ask])

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      <ConfirmDialog
        open={!!req}
        title={req?.title || ''}
        body={req?.body}
        confirmLabel={req?.confirmLabel}
        cancelLabel={req?.cancelLabel}
        tone={req?.tone || 'danger'}
        reasonLabel={req?.reasonLabel}
        reasonPh={req?.reasonPh}
        reason={reason}
        onReason={setReason}
        videoLabel={req?.videoLabel}
        videoUrl={videoUrl}
        onVideoUrl={setVideoUrl}
        onConfirm={() => finish({ reason: reason.trim() || null, ...(req?.videoLabel ? { videoUrl: videoUrl.trim() || null } : {}) })}
        onClose={() => finish(null)}
      />
    </ConfirmCtx.Provider>
  )
}

export function useConfirm() {
  const ask = useContext(ConfirmCtx)
  if (!ask) throw new Error('useConfirm phải nằm trong <ConfirmProvider>')
  return ask
}
