/* =========================================================
   NỀN TRANG — mesh tím/hồng, lấy bảng màu của trang Daily Spin
   ---------------------------------------------------------
   Bốn khối sáng để CSS vẽ; React không giữ state nào ở đây.

   Vì sao là span rỗng chứ không phải một tấm ảnh: mỗi khối cần một chu kỳ
   trôi RIÊNG (44s · 47s · 61s · 83s) để hình không bao giờ lặp lại đúng như
   cũ. Ảnh tĩnh thì không có chuyện đó; bốn phần tử thì compositor lo, chỉ
   đổi transform.

   Vì sao có lớp .bgfx-veil: nền giờ CÓ MÀU. Không có lớp tối hình tròn phủ
   lên thì chữ ở mép trên/dưới mất tương phản. Lớp này chỉ che viền, giữa
   trong suốt hoàn toàn.

   Bộ màu và độ đậm nằm ở token `--mesh-*` trong index.css, không viết ở đây
   — đổi màu là sửa :root, không phải sửa component.
   ========================================================= */
export default function Background() {
  return (
    <div className="bgfx" aria-hidden="true">
      <span className="bgfx-mesh">
        <i /><i /><i /><i />
      </span>
      <span className="bgfx-veil" />
    </div>
  )
}
