/* =========================================================
   NỀN TRANG — aurora trôi rất chậm trên nền gradient tĩnh
   ---------------------------------------------------------
   Không state, không effect, không listener. Ba thẻ trống để CSS vẽ:
     · .bgfx — nền gốc tĩnh (raster một lần, đứng yên)
     · .bgfx-aurora — 3 vệt màu cùng tông logo, TRÔI QUA LẠI bằng
       transform trên một lớp tràn mép (inset âm). Chỉ opacity +
       transform nên compositor lo hết, không vẽ lại gradient.
     · .bgfx-grain — hạt nhiễu opacity thuần, không blend.

   Cố tình KHÔNG dùng: filter: blur() + mix-blend-mode trên lớp fixed
   (trình duyệt hợp thành lại mỗi khung cuộn → xé mảng/nhấp nháy),
   và height: 100dvh (đổi theo thanh địa chỉ mobile → nền giật).
   Lớp phủ dùng inset: 0 nên luôn kín màn hình, không hở đáy.
   ========================================================= */
export default function Background() {
  return (
    <div className="bgfx" aria-hidden="true">
      <span className="bgfx-aurora" />
      <span className="bgfx-grain" />
    </div>
  )
}
