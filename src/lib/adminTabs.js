/* =========================================================
   BẢY MỤC CỦA TRANG QUẢN TRỊ — và địa chỉ của từng mục
   ---------------------------------------------------------
   Danh sách này nằm ở một chỗ vì có BA nơi cần biết nó: dải số liệu của trang
   (mục nào đang mở), App (địa chỉ `/admin?tab=…`), và phép kiểm địa chỉ lúc
   tải trang. Để mỗi nơi tự viết lại mảng là mở đường cho một mục mới xuất hiện
   ở hai nơi và biến mất ở nơi thứ ba.
   Thứ tự trong mảng là thứ tự trên màn hình: việc gấp nhất đứng trước.
   ========================================================= */

export const ADMIN_TABS = ['overview', 'pending', 'active', 'expired', 'picked', 'orders', 'done', 'media', 'log']

/* =========================================================
   MỖI MỤC MỘT DÒNG KHAI — nguồn duy nhất cho dải số liệu
   ---------------------------------------------------------
   Dải số liệu ở đầu trang (vừa là tổng quan vừa là bộ chuyển mục) từng tự
   viết lại danh sách năm mục ngay trong component, kèm nhãn và màu của từng
   mục. Hai danh sách song song nghĩa là thêm một mục ở đây mà quên ở kia thì
   mục mới CÓ địa chỉ nhưng KHÔNG có ô nào để bấm tới — lỗi im lặng, chỉ lộ ra
   khi có người thử mở `/admin?tab=…` bằng tay.
   Nay nhãn + màu + cách đếm nằm cùng chỗ với mã mục, và `AdminPanel` chỉ dựng
   theo mảng này. `count` là tên phép đếm mà trang cung cấp (xem AdminPanel).
   ========================================================= */
export const ADMIN_TAB_META = [
  /* TỔNG QUAN đứng đầu: `/admin` mở ra đây. Nó không phải "việc gấp nhất" mà là
     câu hỏi đầu tiên của người mở bảng — "tuần này thế nào" — và mỗi mục còn
     lại vẫn mang đúng con số việc của mình ngay trên ô bấm tới. */
  { k: 'overview', label: 'adm.overview', tone: 'var(--a-2)',  count: null },
  { k: 'pending', label: 'adm.pending', tone: 'var(--pending)',  count: 'pending' },
  { k: 'active',  label: 'adm.active',  tone: 'var(--progress)', count: 'active' },
  { k: 'expired', label: 'adm.expired', tone: 'var(--denied)',   count: 'expired' },
  /* ĐÃ PICK đứng ngay sau nhóm hàng đợi: nó trả lời "suất Up next đang do bài
     nào giữ". Tách khỏi Đang xử lý vì mục đó gộp cả bài chưa từng được chốt
     (in_progress mà không có picked_at) — hai câu hỏi khác nhau. */
  // "Đã pick" là suất đã chốt → màu Up next, không mượn màu nhấn (trùng --progress).
  { k: 'picked',  label: 'adm.pickedTab', tone: 'var(--upnext)',  count: 'picked' },
  { k: 'orders',  label: 'adm.orders',  tone: 'var(--paid)',     count: 'orders' },
  { k: 'done',    label: 'adm.done',    tone: 'var(--done)',     count: 'done' },
  { k: 'media',   label: 'adm.media',   tone: 'var(--a-2)',      count: 'media' },
  /* Nhật ký đứng CUỐI: nó là chỗ tra cứu khi cần, không phải việc phải làm
     hôm nay — nên nó không được chen trước hàng đợi. Màu `--queued` là tông
     duy nhất còn lại trong bảng màu trạng thái. */
  { k: 'log',      label: 'adm.log',      tone: 'var(--queued)',  count: 'log' },
]

/* Đọc mục đang mở từ địa chỉ. Chỉ nhận giá trị có thật — một `?tab=abc` gõ tay
   phải rơi về mục đầu chứ không được làm trang trắng. */
export function readAdminTab(search) {
  const p = new URLSearchParams(search || '')
  const k = p.get('tab')
  return ADMIN_TABS.includes(k) ? k : null
}

/* Địa chỉ của một mục. Mục đầu (Chờ duyệt) dùng địa chỉ trần `/admin` — địa chỉ
   ngắn nhất là địa chỉ của việc chính, không phải của một tham số thừa. */
export function adminTabPath(base, k) {
  return k && k !== ADMIN_TABS[0] ? `${base}?tab=${encodeURIComponent(k)}` : base
}

/* =========================================================
   BỘ LỌC CỦA BẢNG QUẢN TRỊ CŨNG NẰM Ở ĐỊA CHỈ
   ---------------------------------------------------------
   Một mục đã lọc sẵn ("bài Full Album đang chờ", "đơn đang chờ xếp theo bài
   nhiều vote") là thứ admin hay muốn đưa cho người khác — và cũng là thứ họ
   muốn giữ khi F5. Trước đây ba thứ đó (từ khoá, cách xếp, loại bài) chỉ sống
   trong state của component: mở một thư viện khác là mất, dán địa chỉ cho đồng
   nghiệp thì họ thấy danh sách trần.
   Đọc ở đây (một hàm thuần, test được bằng chuỗi) — giá trị lạ phải rơi về mặc
   định chứ không được làm trang trắng, cùng luật với `readAdminTab`.
   ========================================================= */
/* =========================================================
   TRẠNG THÁI ĐƠN HÀNG CŨNG LÀ MỘT BỘ LỌC
   ---------------------------------------------------------
   Mục Đơn hàng từng liệt kê LẪN đơn đang chờ với đơn đã nhận / đã từ chối:
   danh sách chỉ sắp theo giờ, không có cách nào tách "còn phải xử lý" khỏi
   "đã xong". Ba trạng thái dưới đây là đúng ba trạng thái có thật trong bảng
   `orders`; `all` là giá trị mặc định và không được ghi vào địa chỉ.
   ========================================================= */
export const ADMIN_ORDER_STATES = ['awaiting', 'paid', 'rejected']

export const ADMIN_SORTS = ['default', 'newest', 'votes', 'waiting']

export function readAdminView(search, kinds = [], orderStates = ADMIN_ORDER_STATES) {
  const p = new URLSearchParams(search || '')
  const sort = p.get('sort')
  const kind = p.get('kind')
  const ost = p.get('ost')
  return {
    q: (p.get('q') || '').trim().slice(0, 80),
    sort: ADMIN_SORTS.includes(sort) ? sort : 'default',
    kind: kinds.length === 0 || kinds.includes(kind) ? (kind || 'all') : 'all',
    ost: orderStates.length === 0 || orderStates.includes(ost) ? (ost || 'all') : 'all',
    /* `?focus=<id>` — mở thẳng MỘT bài, dùng khi báo cho chính mình hoặc cho
       người khác "vào sửa bài này". Không kiểm được id có thật hay không ở đây
       (không có database), nên chỉ cắt độ dài và bỏ ký tự lạ; id không tồn tại
       thì trang lặng lẽ bỏ qua, không dựng một khung sửa rỗng. */
    focus: (p.get('focus') || '').trim().slice(0, 64),
  }
}

/* Dựng lại query cho địa chỉ: giữ `tab` (mục đang mở) và chỉ ghi những tham số
   KHÁC mặc định — địa chỉ của một danh sách chưa lọc vẫn là `/admin?tab=…`. */
export function adminQuery({ tab, q = '', sort = 'default', kind = 'all', ost = 'all', focus = '' }) {
  const p = new URLSearchParams()
  if (tab && tab !== ADMIN_TABS[0]) p.set('tab', tab)
  if (q.trim()) p.set('q', q.trim())
  if (sort && sort !== 'default') p.set('sort', sort)
  if (kind && kind !== 'all') p.set('kind', kind)
  if (ost && ost !== 'all') p.set('ost', ost)
  /* `focus` KHÔNG được ghi lại: nó là đích của một lần mở, không phải bộ lọc.
     Ghi lại là F5 lần nữa vẫn mở khung sửa dù admin đã đóng nó từ lâu. */
  void focus
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}
