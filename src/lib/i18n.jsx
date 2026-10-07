/* ============================================================
   i18n.jsx — TẦNG REACT CỦA CHỮ (provider + hook + đọc lỗi).
   ------------------------------------------------------------
   Bản thân chữ nằm trong `strings.js` (JS thuần) để cả những mô-đun không
   React — `lib/spinShield.js` — cũng dùng được đúng một nguồn. Tệp này chỉ
   còn: `translate` (re-export), `<I18nProvider>`, `useI18n()` và `errMsg()`.
   ============================================================ */
import { createContext, useCallback, useContext, useMemo } from 'react'
import { translate } from './strings.js'

/* Re-export: nhiều chỗ gọi (`components/Boundary.jsx`, bài test) vẫn nhập
   `translate` từ tệp này — đổi hết là một lượt sửa vô nghĩa. */
export { translate } from './strings.js'

const I18nCtx = createContext(null)

export function I18nProvider({ children }) {
  const t = useCallback((key, vars) => translate(key, vars), [])
  const value = useMemo(() => ({ t }), [t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nCtx)
  if (!ctx) throw new Error('useI18n phải nằm trong <I18nProvider>')
  return ctx
}

/*
 * Dịch lỗi. Hai nguồn:
 *   · appError('err.xxx', vars) từ lib/db.js — message chính là key
 *   · PostgREST khi hàm SQL raise — code là 'P0001' (vô nghĩa), message
 *     là key 'err.xxx' mà schema.sql raise lên, hoặc một câu tiếng Anh
 *     viết thẳng trong SQL (câu có số kèm nên không qua từ điển được)
 * Vì vậy: ưu tiên chuỗi 'err.*', tuyệt đối không in raw code ra màn hình.
 */
export function errMsg(t, e) {
  const m = typeof e?.message === 'string' ? e.message : String(e?.message ?? e ?? '')
  if (m.startsWith('err.')) return t(m, e?.vars)
  const c = typeof e?.code === 'string' ? e.code : ''
  if (c.startsWith('err.')) return t(c, e?.vars)
  /* 20261122 revoke năm cửa RPC của quiz khỏi mọi client role. Một bundle cũ
     còn nằm trong cache (hoặc tab mở từ trước) vẫn gọi chúng và nhận SQLSTATE
     42501; PostgREST trả về "permission denied for function <tên>". Gặp đúng
     dạng đó thì mời nạp lại trang — câu này còn vô nghĩa hơn cả err.generic, và
     cũng không được lộ tên hàm hay text Postgres. Chỉ khớp khi đối tượng bị từ
     chối là FUNCTION: "permission denied for table/relation/schema" và lỗi RLS
     vẫn đi đường cũ. */
  if ((c === '42501' || /insufficient privilege/i.test(m)) && /permission denied for function/i.test(m)) {
    return t('err.featureRetiredClient')
  }
  if (!m || /^(position|detail|hint|context):|SQLSTATE|row-level security|violates |permission denied|does not exist/i.test(m)) {
    return t('err.generic')
  }
  return m.length > 180 ? m.slice(0, 177) + '…' : m
}
