import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

/* =========================================================
   CALC NOTE — "cách tính" mở ra được, thay cho title tooltip
   ---------------------------------------------------------
   Vì sao có component này: các con số máy tính ra của trang (đếm ngược chốt
   bài, "at least N weeks", hạng) trước đây chỉ giải thích bằng thuộc tính
   `title` — người dùng điện thoại KHÔNG BAO GIỜ thấy được (không có hover),
   và đó lại là nhóm người nghi ngờ nhất ("tôi bỏ 20k rồi thì bao giờ có?").
   ecc.tools đặt câu "Sources & methodology" ngay cạnh mọi con số; đây là bản
   tối giản của ý tưởng đó.

   Cấu trúc là `<details>/<summary>` THUẦN: không state, không onClick, bàn
   phím và trình đọc màn hình tự lo. Tên của nút nằm trong `.sr-only`
   ("How this is calculated") — chữ "?" hay icon không bao giờ được làm tên
   nút (bài học aria-label của vòng A1-3).

   `items` = [{ label, text }] — NƠI GỌI đã dịch qua i18n rồi truyền xuống.
   Panel là một `<dl>` nhãn–câu: mắt quét được cột nhãn, mỗi sự thật đúng
   MỘT câu — so với bản cũ nhét cả đoạn văn vào một `<p>`, người hỏi thấy
   câu trả lời trước khi kịp bỏ đi. Một component, mọi con số dùng chung.
   ========================================================= */

export default function CalcNote({ items }) {
  const { t } = useI18n()
  return (
    <details className="calc">
      <summary>
        <Icon name="info" size={13} />
        <span className="sr-only">{t('calc.how')}</span>
      </summary>
      <dl className="calc-rows">
        {(items || []).map((it) => (
          <div className="calc-row" key={it.label}>
            <dt>{it.label}</dt>
            <dd>{it.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
