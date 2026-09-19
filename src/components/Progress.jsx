/* Thanh tiến độ của một request: vạch và con số là MỘT khối.
   ---------------------------------------------------------
   Bản trước in một con số trần ("45%") mang theo cả cái chấm tròn của nhãn
   trạng thái, rồi NGAY DƯỚI nó là một vạch 3px không dính gì tới con số: mắt
   phải tự nối hai thứ rời nhau, con số nằm lệch trái còn vạch dài hết cỡ, và
   vì không có nhãn nên trình đọc màn hình chỉ đọc trơ "bốn mươi lăm phần trăm"
   nằm lơ lửng giữa dòng.

   Bản này:
     · vạch là nền, số nằm sát mép phải vạch, cùng một hàng;
     · số dùng chữ mono + chữ số đều (tabular-nums) nên cột số không nhảy khi
       phần trăm đổi từ 9% lên 100%;
     · `role="progressbar"` + aria-valuenow: máy đọc đúng cặp "nhãn + giá trị",
       còn chữ trong khối chỉ để mắt đọc;
     · mọi giá trị rác (undefined, "abc", 150, -3) đều bị kẹp về 0..100 ở ĐÂY,
       không rải việc kiểm tra ra từng chỗ gọi;
     · 0% thì KHÔNG vẽ vạch (xem chú thích ở khối render) — một que màu 6px
       nằm đó trong khi con số cạnh nó ghi "0%" là hai chỗ nói ngược nhau.

   Component không đọc context (nhãn truyền từ ngoài) nên render được một mình
   trong test — xem src/components/Progress.test.js. */
export default function Progress({ pct, label, wide = false }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  /* 100% là một TRẠNG THÁI, không phải một con số nữa: ba mốc Layout/Lyrics/Edit
     đã tick hết. Vạch đổi màu ngay tại đây — màu là việc của CSS (`.prog-full`),
     không phải một prop, vì mỗi chỗ gọi tự chọn một màu chính là cách thanh tiến
     độ của CÙNG MỘT bài từng có hai màu khác nhau ở trang chủ và bảng quản trị. */
  const full = v >= 100
  return (
    <div className={`prog${wide ? ' prog-wide' : ''}${full ? ' prog-full' : ''}`}
      role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
      aria-label={label}>
      {/* KHÔNG vẽ vạch khi 0%. Trước đây vạch luôn được dựng và luôn có
         `min-width: 6px` (để 1% nhìn thấy được), nên ở 0% vẫn có một que màu
         nằm trong rãnh — trong khi con số ngay cạnh ghi "0%": hai chỗ nói
         ngược nhau. Cần `min-width` cho 1% thì vẫn giữ, nhưng nó chỉ có nghĩa
         khi phần tử tồn tại. */}
      <span className="prog-track" aria-hidden="true">
        {v > 0 && <i style={{ '--w': `${v}%` }} />}
      </span>
      {/* Nhãn đã nằm ở aria-label; `%` chỉ là chữ để mắt đọc, không đọc lại. */}
      {!wide && <b className="prog-num">{v}<span aria-hidden="true">%</span></b>}
    </div>
  )
}
