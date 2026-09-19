/* LƯỚI AN TOÀN CUỐI CÙNG — một component ném lỗi thì cả trang thành màn hình
   đen, không một chữ giải thích.
   ---------------------------------------------------------------------------
   Vì sao có: React 19 gỡ sạch cây DOM khi render ném lỗi. Người dùng chỉ thấy
   nền tối của trang — không biết là app hỏng, mạng hỏng hay đang tải. Người
   sửa cũng không có gì để đọc nếu không mở console. Một lưới nhỏ ở gốc đổi
   trạng thái đó thành: một câu giải thích + nút tải lại + lỗi thật (gấp trong
   `<details>` để không doạ người dùng thường, nhưng vẫn dán được khi báo lỗi).

   Đây là lưới CUỐI, không phải cách xử lý lỗi thường ngày: lỗi mạng, lỗi
   nghiệp vụ vẫn đi đường toast như cũ. Chỉ render mới rơi vào đây.

   `CrashCard` tách riêng để test SSR được (ErrorBoundary cần môi trường DOM
   thật mới chạy), còn class `Catcher` giữ phần bắt lỗi — React 19 vẫn chỉ cho
   class component làm việc này. */

import { Component } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'

export function CrashCard({ err, t }) {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    <div className="crash" role="alert">
      <div className="crash-card">
        <Icon name="warn" size={20} className="crash-ico" />
        <b className="crash-title">{t('crash.title')}</b>
        <p className="crash-body">{t('crash.body')}</p>
        {msg && (
          <details className="crash-more">
            <summary>{t('crash.details')}</summary>
            <pre>{msg}</pre>
          </details>
        )}
        <button type="button" className="btn btn-primary crash-btn"
          onClick={() => window.location.reload()}>{t('crash.reload')}</button>
      </div>
    </div>
  )
}

class Catcher extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    /* Giữ nguyên lỗi gốc trong console: lưới này để người dùng đọc, không
       thay log của lập trình viên. */
    console.error('[ccl] lỗi khi dựng trang:', err, info?.componentStack)
  }
  render() {
    if (this.state.err) return <CrashCard err={this.state.err} t={this.props.t} />
    return this.props.children
  }
}

export default function ErrorBoundary({ children }) {
  const { t } = useI18n()
  return <Catcher t={t}>{children}</Catcher>
}
