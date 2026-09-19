import { Component } from 'react'
import Icon from './Icon'

/* =========================================================
   LƯỚI AN TOÀN CHO MỘT KHỐI CỦA TRANG
   ---------------------------------------------------------
   Một lỗi ném ra trong lúc RENDER (một trường dữ liệu lạ, một
   hàm bị gọi khi chưa có dữ liệu, một API trình duyệt không có
   mặt) làm React tháo sạch cây — người dùng nhìn thấy trang
   trắng và không biết chuyện gì vừa xảy ra. Với một trang quản
   trị, "trắng" còn tệ hơn "hỏng": không có gì để bấm, không có
   gì để đọc, không có đường quay lại.

   Khối này giữ MỘT vùng: nếu vùng đó ném lỗi thì chỉ vùng đó
   biến thành một tấm bảng đọc được, phần còn lại của trang (menu,
   chuyển mục khác) vẫn sống, và có nút thử dựng lại vùng đó.

   Cố ý là class component: React chỉ gọi `getDerivedStateFromError`
   / `componentDidCatch` trên class — hooks không có đường tương
   đương.
   ========================================================= */
export default class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(err) {
    return { err: err || new Error('unknown') }
  }

  componentDidCatch(err) {
    /* Giữ lại trong console để còn lần ra gốc — tấm bảng trên màn hình là
       để người dùng biết đường, console mới là chỗ để sửa. */
    console.error('[boundary]', this.props.label || '', err)
  }

  retry() {
    this.setState({ err: null })
  }

  render() {
    if (!this.state.err) return this.props.children
    const { label, title, body, retry: retryText } = this.props
    return (
      <div className="boundary" role="alert">
        <Icon name="warn" size={18} className="boundary-ico" />
        <div className="boundary-tx">
          <b>{title || 'This part could not load'}</b>
          <p>{body || 'The rest of the page still works. Try again, or reload the page.'}</p>
          {label && <small>{label}</small>}
        </div>
        {retryText && (
          <button type="button" className="btn btn-sm" onClick={this.retry}>{retryText}</button>
        )}
        <details className="boundary-why">
          <summary>Technical details</summary>
          <code>{String(this.state.err?.message || this.state.err)}</code>
        </details>
      </div>
    )
  }
}
