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
       không rải việc kiểm tra ra từng chỗ gọi.

   Component không đọc context (nhãn truyền từ ngoài) nên render được một mình
   trong test — xem src/components/Progress.test.js. */
export default function Progress({ pct, label, color = null, wide = false }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  return (
    <div className={`prog${wide ? ' prog-wide' : ''}`}
      style={color ? { '--sc': color } : undefined}
      role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
      aria-label={label}>
      <span className="prog-track" aria-hidden="true"><i style={{ '--w': `${v}%` }} /></span>
      {/* Nhãn đã nằm ở aria-label; `%` chỉ là chữ để mắt đọc, không đọc lại. */}
      {!wide && <b className="prog-num">{v}<span aria-hidden="true">%</span></b>}
    </div>
  )
}
