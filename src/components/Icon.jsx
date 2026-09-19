/* Bộ icon của trang — Lucide (lucide.dev, giấy phép ISC).
   ---------------------------------------------------------
   Vì sao bọc một lớp thay vì import thẳng ở từng chỗ:
     · MỘT chỗ khai cỡ mặc định (16px), độ dày nét (1.7 — khớp nét viền 1px
       của trang) và `aria-hidden`; icon trang trí không được để trình đọc màn
       hình biến thành chữ;
     · sau này đổi bộ icon là sửa đúng một file, không đi lùng từng nút;
     · tên gọi đặt theo VIỆC ("close", "prev", "sound") chứ không theo hình,
       nên chỗ dùng không cần biết Lucide gọi nó là gì.

   Icon là SVG NÉT (fill:none, stroke:currentColor) nên tự ăn màu chữ của chỗ
   đặt nó — không cần biến màu riêng. Chỗ nào cần hình ĐẶC (nút play trên
   video) thì truyền `fill`.

   Hai nhãn hiệu (YouTube, Telegram) cố ý KHÔNG nằm ở đây: Lucide không vẽ
   logo thương hiệu, mà logo thì phải đúng logo — chúng nằm ngay tại chỗ dùng
   trong Sidebar.jsx. Google cũng vậy (GoogleIcon.jsx). */
import {
  ArrowUp, ArrowUpRight, Bell, BellRing, Check, ChevronLeft, ChevronRight,
  CircleAlert, Disc3, Info, ListMusic, LogOut, Minus, Music4, Pencil, Play,
  Plus, Send, Share2, ShieldCheck, SlidersHorizontal, Star, Trophy, User, Volume2,
  VolumeX, X,
} from 'lucide-react'

/* tên theo VIỆC -> icon Lucide */
const SET = {
  up: ArrowUp,                    /* lên đầu trang */
  ext: ArrowUpRight,              /* link mở ra ngoài */
  bell: Bell,                     /* chuông — chưa theo dõi */
  bellOn: BellRing,               /* chuông — đang theo dõi */
  close: X,                       /* đóng / xoá một mục */
  prev: ChevronLeft,
  next: ChevronRight,
  settings: SlidersHorizontal,    /* tuỳ chọn thông báo */
  check: Check,
  info: Info,
  warn: CircleAlert,
  star: Star,
  play: Play,
  board: ListMusic,               /* bảng yêu cầu */
  spin: Disc3,                    /* vòng quay */
  cup: Trophy,                    /* xếp hạng */
  user: User,
  shield: ShieldCheck,            /* bảng Admin */
  out: LogOut,
  edit: Pencil,                   /* viết yêu cầu mới */
  minus: Minus,
  plus: Plus,
  sound: Volume2,
  mute: VolumeX,
  note: Music4,                   /* âm thanh trong sidebar */
  send: Send,
  share: Share2,                  /* copy link của một bài */
}

export default function Icon({ name, size = 16, className = '', fill = null }) {
  const Glyph = SET[name]
  if (!Glyph) return null
  /* Dựng props theo object rồi trải ra, KHÔNG truyền `fill={undefined}`:
     Lucide đặt `fill:"none"` trong defaultAttributes, mà một prop `fill`
     bằng undefined vẫn ghi đè giá trị mặc định đó — icon sẽ bị tô đen. */
  const props = { size, strokeWidth: 1.7, className, 'aria-hidden': 'true' }
  if (fill) props.fill = fill
  return <Glyph {...props} />
}
