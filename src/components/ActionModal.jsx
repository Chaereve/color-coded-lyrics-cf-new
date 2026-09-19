import { useEffect, useMemo, useRef, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import { KINDS, VOTE_PACKS, SINGLE_VOTE, singlePrice, PAID_REQUEST } from '../lib/db'
import { KIND_META, isPicked, kindCls, vnd, usd } from '../lib/meta'
import { findDuplicate, splitSong } from '../lib/board'
import { SUPPORT } from '../lib/payment'
import { parseYoutube, thumbUrl } from '../lib/youtube'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { sfx } from '../lib/sfx'
import { useModalExit } from '../lib/useModalExit'
import PaymentMethods from './PaymentMethods'
import Pager from './Pager'
import { usePager } from '../lib/usePager'

const VOTE_PER_PAGE = 8

/* Rules chỉ hiện 1 lần duy nhất — bấm Agree là nhớ vào localStorage. */
const RULES_KEY = 'ccl.reqRules'
const RULES_V = 'v1'

/* BẢN NHÁP CỦA FORM REQUEST.
   ---------------------------------------------------------
   Một request mất ba ô chữ (tên bài, nghệ sĩ, link) — người dùng hay đi tìm
   link rồi quay lại tab, hoặc bấm nhầm ra ngoài hộp thoại. Không có nháp thì
   mọi thứ vừa gõ biến mất, và việc gửi request trở thành việc phải làm một hơi.
   Nháp nằm trong localStorage (không tốn request nào, không cần đăng nhập lại),
   tự xoá sau khi gửi thành công, và tự bỏ nếu cũ quá 7 ngày — nửa cái form từ
   tháng trước không phải là "việc đang làm dở". */
const DRAFT_KEY = 'ccl.reqDraft'
const DRAFT_V = 1
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000

/* BA BƯỚC CỦA FORM GỬI REQUEST — nhãn lấy từ từ điển, đúng ba việc phải làm.
   Hằng số nằm ngoài component: dải bước và phần thân phải đọc CÙNG một danh
   sách, nếu không thì thêm một bước là chỗ này có mà chỗ kia không. */
const REQ_STEPS = ['req.step1', 'req.step2', 'req.step3']

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!d || d.v !== DRAFT_V) return null
    if (Date.now() - (d.at || 0) > DRAFT_TTL) return null
    const txt = `${d.artist || ''}${d.title || ''}${d.link || ''}${d.note || ''}`.trim()
    return txt ? d : null
  } catch { return null }   /* chặn storage / JSON hỏng: coi như không có nháp */
}

function RulesGate({ onAgree }) {
  const { t } = useI18n()
  return (
    <div className="rules">
      <h3>{t('req.rulesTitle')}</h3>
      <ol>
        <li><b>1</b><span>{t('req.rule1')}</span></li>
        <li><b>2</b><span>{t('req.rule2')}</span></li>
        <li><b>3</b><span>{t('req.rule3')}</span></li>
        <li><b>4</b><span>{t('req.rule4')}</span></li>
        <li><b>5</b><span>{t('req.rule5')}</span></li>
      </ol>
      <button className="btn btn-primary" onClick={onAgree}>{t('req.agree')}</button>
    </div>
  )
}

/* ------------------------- TAB: GỬI REQUEST -------------------------
   Ba nguyên tắc của bản này:
   1. NÓI RA CHỖ SAI NGAY TẠI CHỖ ĐÓ. Ô bắt buộc được kiểm tra theo từng ô:
      rời ô (blur) mà còn trống thì hiện câu giải thích ngay dưới ô, ô được
      đánh dấu `aria-invalid` và trỏ tới câu đó bằng `aria-describedby`. Bấm Gửi
      khi còn thiếu thì con trỏ NHẢY vào ô sai đầu tiên — trước đây chỉ có một
      dòng lỗi chung ở cuối form, người dùng phải tự đoán ô nào.
   2. MỘT FORM, MỘT ĐƯỜNG ĐI. Dải 3 bước ở trên cùng (chọn loại → điền tên →
      gửi) sáng dần theo việc đã làm; mỗi bước là một việc, không phải một
      trang riêng. Không có bước ẩn nào để người dùng phát hiện ra muộn.
   3. CHỌN LOẠI BÀI LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI BỐN CÁI NHÃN. Mỗi loại có
      một dòng giải thích nó khác gì ba loại kia — "Full Album" với "Short"
      là hai sản phẩm khác hẳn nhau, còn bốn chữ trần thì không nói gì.
   Giữ nguyên mọi hành vi cũ: dò trùng khi đang gõ, bảng luật 1 lần, ghim
   prefill từ link mời, nút gửi bám đáy. */
const URL_RE = /^https?:\/\/\S+$/i

function RequestTab({ onSubmit, live = true, rows = [], allRows, onVoteExisting, prefill, userName = '' }) {
  const { t } = useI18n()
  /* Link mời (`?add=1&artist=…&title=…`) đổ sẵn vào form: người bấm link từ mô
     tả video chỉ còn phải bấm Gửi. Giá trị đã được cắt theo maxLength của ô
     nhập ở `parseRequestPrefill` nên không có chuyện chữ từ URL dài hơn ô. */
  /* Link mời (`?add=1&…`) là một lời mời có chủ đích nên nó THẮNG bản nháp;
     chỉ khi không có link mời mới dựng lại việc đang làm dở. */
  const [draft] = useState(() => (prefill ? null : readDraft()))
  const [restored, setRestored] = useState(!!draft)
  const [form, setForm] = useState(() => ({
    kind: KINDS.includes(draft?.kind) ? draft.kind : KINDS[0],
    artist: draft?.artist || prefill?.artist || '',
    title: draft?.title || prefill?.title || '',
    link: draft?.link || prefill?.link || '',
    note: draft?.note || '',
  }))
  /* O "bai tra phi" luon bat dau tat. Tung co prop `paidDefault` de mo form dang
     tick san, nhung khong mot ai truyen no — xoa di con hon de nguoi doc tuong
     la co loi tat. */
  const [paid, setPaid] = useState(() => !!draft?.paid)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  /* Ô nào đã được RỜI khỏi: chỉ hiện lỗi sau khi người dùng đi qua ô đó, không
     hiện ngay từ ký tự đầu tiên — form mở ra đã đỏ là form bị lỗi. */
  const [touched, setTouched] = useState({})
  /* Ô GHI CHÚ: ô tuỳ chọn duy nhất của form, và cũng là ô cao nhất (textarea
     ba dòng). Để nó mở sẵn là bắt MỌI người trả lời một câu mà phần lớn không
     cần trả lời. Gấp khi chưa có chữ; đã có chữ (nháp, link mời) thì mở sẵn —
     lúc đó nó là việc đang làm dở, không phải một lời mời. */
  const [noteOpen, setNoteOpen] = useState(() => !!(draft?.note || prefill?.note || '').trim())
  const [agreed, setAgreed] = useState(() => {
    try { return localStorage.getItem(RULES_KEY) === RULES_V } catch { return false }
  })
  /* BƯỚC ĐANG ĐỨNG. Không phải một bộ đếm trang trí: mỗi bước là một MÀN, chỉ
     bước đang đứng được dựng ra. Mở form với dữ liệu đã có sẵn (nháp, link mời)
     thì vào thẳng bước đang làm dở — bước 1 (chọn loại) chỉ có nghĩa khi chưa có
     gì để gõ. */
  const [step, setStep] = useState(() => (form.artist.trim() || form.title.trim() ? 2 : 1))
  const formRef = useRef(null)
  const artistRef = useRef(null)
  const titleRef = useRef(null)
  const noteRef = useRef(null)
  /* Bấm "Add a note" thì con trỏ phải rơi vào ô vừa hiện — nếu không, người
     dùng còn phải bấm thêm một lần nữa vào đúng chỗ vừa mở. Cờ `wantsNote`
     để lần render sau khi mở mới focus, và chỉ focus khi người dùng CHỦ ĐỘNG
     mở (không cướp con trỏ lúc form khôi phục nháp). */
  const wantsNote = useRef(false)

  /* Tra bảng loại bài LUÔN phải có kết quả: `form.kind` đi qua state nên về lý
     thuyết chỉ nhận bốn giá trị của KINDS, nhưng tra trượt ở đây là TypeError
     ngay trong lúc render — cả form biến mất chỉ vì một giá trị lạ. Trượt thì
     lấy loại đầu. */
  const meta = KIND_META[form.kind] || KIND_META[KINDS[0]]
  const titleLabel = t(meta.titleKey)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const blur = (k) => () => setTouched(s => ({ ...s, [k]: true }))

  /* Dò trùng NGAY LÚC GÕ, không đợi tới lúc bấm Gửi. Một bài do ba người gửi
     lẻ là gốc của cả việc cụm 9 vote bị xếp dưới bài 5 vote lẫn việc farm vote
     bằng nhiều tài khoản; nói ra ở ô nhập thì rẻ hơn nhiều so với đi gộp ở tầng
     SQL sau khi dữ liệu đã bẩn. Chỉ dò khi cả tên bài lẫn nghệ sĩ đã đủ dài
     (xem `findDuplicate`) nên trong lúc gõ bình thường không có gì nhấp nháy. */
  /* Dò trên `allRows` (mọi hàng, kể cả đang chờ duyệt và đã bị từ chối) chứ
     không phải `rows` — bảng chỉ hiện hàng công khai, còn ở đây ta cần biết
     "tôi vừa gửi bài này rồi" ngay cả khi nó chưa được duyệt. */
  const dup = useMemo(() => findDuplicate(allRows || rows, form), [allRows, rows, form])

  /* TIÊU ĐỀ VIDEO DÁN NGUYÊN SI: gợi ý tách thành hai ô (xem `splitSong`).
     Người dùng copy tiêu đề video là cách nhanh nhất để điền form — và cũng là
     cách chắc chắn nhất để ô tên bài chứa cả tên nghệ sĩ. Gợi ý này KHÔNG tự
     sửa gì: nó nói ra hai vế đã đọc được, người dùng bấm một lần là xong.
     Chỉ hiện khi hai vế thật sự KHÁC điều đang có trong form, nếu không thì
     đây chỉ là một dải chữ nhắc lại đúng những gì đang nhìn thấy. */
  const split = useMemo(() => {
    const got = splitSong(form.title)
    if (!got) return null
    if (got.artist === form.artist.trim() && got.title === form.title.trim()) return null
    return got
  }, [form.title, form.artist])
  const applySplit = () => {
    if (!split) return
    setForm(f => ({ ...f, artist: split.artist, title: split.title }))
    setTouched(s2 => ({ ...s2, artist: true, title: true }))
  }

  /* LINK YOUTUBE: nhận ra ngay khi dán, và nói ra bằng ẢNH BÌA của chính video
     đó (i.ytimg.com, không cần API key, không tốn quota). Trước đây ô link chỉ
     có một câu nhắc chung chung nên dán đúng hay sai cũng nhìn giống nhau. */
  const yt = useMemo(() => parseYoutube(form.link), [form.link])
  const ytId = yt?.id || null

  /* Ghi nháp hoãn 400ms: mỗi ký tự gõ vào không phải một lần ghi ổ quang. Form
     trống thì xoá nháp luôn, kẻo lần sau mở lên lại thấy một cái form "khôi phục"
     mà chẳng có gì trong đó. */
  useEffect(() => {
    const id = setTimeout(() => {
      const empty = !(form.artist.trim() || form.title.trim() || form.link.trim() || form.note.trim())
      try {
        if (empty) localStorage.removeItem(DRAFT_KEY)
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: DRAFT_V, at: Date.now(), ...form, paid }))
      } catch { /* chặn storage thì form vẫn chạy, chỉ là không nhớ được */ }
    }, 400)
    return () => clearTimeout(id)
  }, [form, paid])

  /* Hai việc khác nhau, đừng gộp: QUÊN nháp là chỉ xoá bản lưu (dùng sau khi
     gửi xong — chữ trong form đã được dọn ở đường gửi), còn BỎ nháp là quên +
     dọn form, vì nút "Bỏ nháp" nằm ngay cạnh câu "form được khôi phục từ nháp":
     bấm vào mà chữ vẫn còn nguyên thì người dùng vừa bấm cái gì? */
  const forgetDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* không xoá được thì thôi */ }
    setRestored(false)
  }
  /* DỌN FORM: xoá chữ, xoá nháp, và đưa về bước 1 — dọn nửa vời (chữ trắng
     nhưng đang đứng ở bước 3) là một màn hình trống không nói gì. */
  const clearForm = () => {
    forgetDraft()
    setForm(f => ({ ...f, artist: '', title: '', link: '', note: '' }))
    setTouched({}); setMsg(null); setStep(1); setNoteOpen(false)
  }
  const discardDraft = () => { clearForm(); artistRef.current?.focus() }

  useEffect(() => {
    if (noteOpen && wantsNote.current) {
      wantsNote.current = false
      noteRef.current?.focus()
    }
  }, [noteOpen])

  const openNote = () => { wantsNote.current = true; setNoteOpen(true) }

  /* Điều hướng ba bước. `goStep` cho bấm thẳng trong dải bước, nhưng bước GỬI
     chỉ mở khi hai ô bắt buộc đã có chữ — nếu không, "sang bước 3" và "bấm Gửi"
     là hai câu trả lời khác nhau cho cùng một câu hỏi. */
  /* Tiếng đi kèm việc đổi bước: tiến và lùi là HAI tiếng khác hướng, nên tai
     nghe ra mình vừa đi đâu. `goStep` phát tiếng theo hướng bước đích. */
  const goStep = (n) => {
    /* Bước GỬI chưa mở thì không đi, và tiếng là tiếng LỖI — im lặng thì người
       bấm không biết mình vừa bấm hụt. */
    if (n === 3 && !ready) { sfx.error(); return }
    if (n === step) return
    sfx[n > step ? 'step' : 'back']()
    setStep(n)
  }
  const next = () => {
    if (step === 1) { sfx.step(); setStep(2); return }
    if (step === 2) {
      /* Bấm Continue khi còn ô trống: tiếng lỗi + mở lỗi + trỏ vào ô đầu tiên.
         Ba dấu hiệu cho cùng một việc, nhưng ở ba giác quan khác nhau — mắt
         nhìn thấy lỗi, tay thấy con trỏ, tai nghe ra "chưa được". */
      if (!ready) {
        sfx.error()
        setTouched(s2 => ({ ...s2, artist: true, title: true }))
        ;(errArtist ? artistRef : titleRef).current?.focus()
        return
      }
      sfx.step()
      setStep(3)
    }
  }
  const back = () => { sfx.back(); setStep(s2 => Math.max(1, s2 - 1)) }
  /* Đổi bước là đổi màn: đưa khung cuộn của hộp thoại về đỉnh, nếu không thì
     bước mới mở ra ở giữa chừng vì khung còn đứng nguyên chỗ cuộn cũ. */
  useEffect(() => {
    const body = formRef.current?.closest('.modal-body')
    if (body && typeof body.scrollTo === 'function') {
      try { body.scrollTo({ top: 0 }) } catch { /* jsdom không có layout */ }
    }
  }, [step])

  const agree = () => {
    try { localStorage.setItem(RULES_KEY, RULES_V) } catch { /* private mode */ }
    setAgreed(true)
  }

  const paidPrice = `${usd(PAID_REQUEST.usd)} / ${vnd(PAID_REQUEST.vnd)}`

  /* Lỗi chặn gửi (hai ô bắt buộc) và cảnh báo không chặn (link sai dạng —
     người ta hay dán "youtu.be/abc" nên đây chỉ là nhắc, không phải cửa chặn). */
  const errArtist = !form.artist.trim() ? t('req.errArtist') : ''
  const errTitle = !form.title.trim() ? t('req.errTitle', { f: titleLabel.toLowerCase() }) : ''
  const warnLink = form.link.trim() && !URL_RE.test(form.link.trim()) ? t('req.warnLink') : ''
  /* Dòng dưới ô Link nay chỉ dựng khi CÓ điều để nói (vòng 13), nên liên kết
     `aria-describedby` cũng phải theo: trỏ vào một id không tồn tại là một liên
     kết đứt — trình đọc màn hình không đọc gì, mà máy kiểm DOM thì báo lỗi. */
  const hasLinkHint = !!(warnLink || ytId || yt?.kind === 'playlist')
  const err = { artist: errArtist, title: errTitle }
  const showErr = (k) => (touched[k] ? err[k] : '')
  const ready = !errArtist && !errTitle

  /* Thân của việc gửi, tách khỏi sự kiện submit để phím Enter trong ô tên bài
     gọi được cùng một đường (một luật gửi, hai lối vào). */
  const goSubmit = async () => {
    /* Thiếu ô nào thì đánh dấu ô đó rồi đưa con trỏ tới nó — câu trả lời nằm
       ngay chỗ cần sửa, không phải một dòng chữ ở cuối form. */
    if (!ready) {
      setTouched(s => ({ ...s, artist: true, title: true }))
      ;(errArtist ? artistRef : titleRef).current?.focus()
      return
    }
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      await onSubmit(form, paid)
      setForm({ ...form, artist: '', title: '', link: '', note: '' })
      setTouched({})
      setStep(1)      /* gửi xong thì form về bước đầu, sẵn sàng cho bài kế tiếp */
      forgetDraft()   /* gửi xong thì việc đang làm dở đã thành việc đã gửi */
      setMsg({ t: 'ok', m: paid ? t('req.okPaid', { p: paidPrice }) : t('req.ok') })
    } catch (e2) { setMsg({ t: 'err', m: errMsg(t, e2) }) }
    finally { setBusy(false) }
  }
  const submit = (e) => { e.preventDefault(); goSubmit() }

  /* DÁN LINK Ở ĐÂU CŨNG ĐƯỢC: người dùng copy link video rồi dán vào ô đang mở
     — thường là ô tên bài. Nếu chuỗi vừa dán CHÍNH LÀ một link thì đưa nó về
     đúng ô Link thay vì nhét một URL dài vào tên bài; còn câu trộn chữ với link
     thì để nguyên, người dùng tự cắt. */
  const pasteLink = (e) => {
    const txt = (e.clipboardData?.getData('text') || '').trim()
    if (!URL_RE.test(txt)) return
    e.preventDefault()
    setForm(f => ({ ...f, link: txt }))
    setTouched(s => ({ ...s, link: true }))
  }

  if (!agreed) return <RulesGate onAgree={agree} />

  /* Bộ đếm ký tự chỉ hiện khi đã dùng gần hết ô (70%) — một con số "0/120"
     thường trực chỉ làm hàng nhập thêm chữ. */
  const left = (k, max) => (form[k].length > max * 0.7
    ? <span className="fcount">{form[k].length}/{max}</span> : null)

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      {/* DẢI BƯỚC — BỘ CHỈ BÁO TIẾN TRÌNH THẬT, KHÔNG PHẢI BA CÁI NHÃN.
          Bản cũ là ba ô chữ nằm cạnh nhau, còn form thì vẫn là một cột dài với
          mọi ô hiện cùng lúc: dải đó chỉ nói "form có ba việc", không nói người
          dùng đang ở đâu. Nay ba bước là BA MÀN:
            · bước xong đổi số thành dấu ✓ và đoạn nối tới nó được tô kín —
              vạch tiến trình nằm ngay trong dải bước, nên không cần thêm một
              thanh phần trăm thứ hai nói lại đúng một điều;
            · bước đang đứng mang `aria-current="step"` và viền nhấn;
            · bấm quay lại được (chỉ tới bước đã qua), nên không phải nhớ đường.
          Thứ tự DOM = thứ tự Tab = thứ tự đọc của trình đọc màn hình. */}
      <ol className="req-steps" aria-label={t('req.stepsAria')}>
        {REQ_STEPS.map((k, i) => {
          const n = i + 1
          const done = step > n
          const here = step === n
          return (
            <li key={k} className={`req-step${here ? ' on' : ''}${done ? ' done' : ''}`}>
              <button type="button" className="rs-btn" disabled={n === 3 && !ready}
                aria-current={here ? 'step' : undefined}
                onClick={() => goStep(n)}>
                <b className="rs-n">{done ? <Icon name="check" size={12} /> : n}</b>
                <span className="rs-t">{t(k)}</span>
              </button>
              {n < REQ_STEPS.length && <i className="rs-line" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>

      {/* Nháp được khôi phục: nói ra, kèm lối bỏ — người dùng phải biết vì sao
          form đã có sẵn chữ, và phải có cách xoá nếu đó là việc của người khác
          trên cùng máy. */}
      {restored && (
        <p className="draft-note" role="status">
          <Icon name="info" size={13} />
          {t('req.draftRestored')}
          <button type="button" className="lnk" onClick={discardDraft}>{t('req.draftClear')}</button>
        </p>
      )}

      {/* ---------- BƯỚC 1: CHỌN LOẠI BÀI ---------- */}
      {step === 1 && (
        <div className="req-pane" key="p1">
          <div className="field">
            <label id="kind-label">{t('req.kind')}</label>
            {/* MỘT hàng chip, và MỘT dòng giải thích cho loại ĐANG chọn.
                Bản trước là bốn tấm thẻ, mỗi thẻ kèm một câu giải thích: muốn chọn
                một loại thì mắt phải đọc bốn câu, và cả khối chiếm gần một phần ba
                chiều cao form — đúng thứ bị gọi là "rối mắt". Câu giải thích vẫn
                còn nguyên, chỉ chuyển tới chỗ nó có ích: dưới lựa chọn đang bấm. */}
            <div className="kindpicks" role="group" aria-labelledby="kind-label">
              {KINDS.map(k => (
                <button type="button" key={k}
                  className={`kchip ${kindCls(k)}${form.kind === k ? ' on' : ''}`}
                  aria-pressed={form.kind === k}
                  title={t(`req.kindHint.${kindCls(k)}`)}
                  onClick={() => setForm(f => ({ ...f, kind: k }))}>
                  {form.kind === k && <Icon name="check" size={13} />}
                  <span>{k}</span>
                </button>
              ))}
            </div>
            {/* Dòng này ĐỔI theo lựa chọn nên nó vừa giải thích vừa xác nhận, chứ
                không phải một dải chữ tĩnh nằm đó suốt buổi. */}
            <p className="kind-note" key={form.kind}>
              <span className={`kind ${kindCls(form.kind)}`}>{form.kind}</span>
              <b>{t(`req.kindHint.${kindCls(form.kind)}`)}</b>
              {meta.noteKey && <span className="kind-note-sub">{t(meta.noteKey)}</span>}
            </p>
          </div>
        </div>
      )}

      {/* ---------- BƯỚC 2: TÊN BÀI ----------
          Toàn bộ việc "bài này là bài nào" nằm trong một bước: tên bài, nghệ sĩ,
          gợi ý tách tiêu đề dán từ YouTube, link video, và tấm thẻ xem trước
          đúng cái mà người khác sẽ thấy. Link ở ĐÂY chứ không phải ở bước gửi:
          nó là một phần của việc nhận diện bài, và thẻ xem trước đứng ngay dưới nó. */}
      {step === 2 && (
        <div className="req-pane" key="p2">
          {/* HAI Ô CHÍNH — hai lối tắt ở đây đều là đường đi ngắn nhất của người
              đã biết mình muốn gì:
                · Enter ở ô nghệ sĩ là "xong ô này" → nhảy sang ô tên bài;
                · Enter ở ô tên bài (khi đã đủ hai ô) là GỬI luôn;
                · dán một link vào BẤT KỲ ô nào trong hai ô → link về đúng ô Link,
                  không nhét một URL dài vào tên bài. */}
          <div className="field-row">
            <div className="field">
              <label htmlFor="rq-artist">{t('req.artist')} <span aria-hidden="true">*</span></label>
              <div className="fin">
                <input id="rq-artist" ref={artistRef} value={form.artist} onChange={set('artist')}
                  onBlur={blur('artist')} onPaste={pasteLink} maxLength={120} autoComplete="off"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); titleRef.current?.focus() } }}
                  aria-invalid={showErr('artist') ? 'true' : undefined}
                  aria-describedby={showErr('artist') ? 'err-artist' : undefined}
                  placeholder={t('req.artistPh')} />
                {left('artist', 120)}
              </div>
              {showErr('artist') && <p className="ferr" id="err-artist" role="alert">{showErr('artist')}</p>}
            </div>
            <div className="field">
              <label htmlFor="rq-title">{titleLabel} <span aria-hidden="true">*</span></label>
              <div className="fin">
                <input id="rq-title" ref={titleRef} value={form.title} onChange={set('title')}
                  onBlur={blur('title')} onPaste={pasteLink} maxLength={160} autoComplete="off"
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    /* Enter ở ô tên bài là "xong bước này", không phải "gửi luôn":
                       ở bước 3 còn ô link, ô ghi chú và lựa chọn bài trả phí mà
                       người dùng chưa nhìn thấy. */
                    if (ready) setStep(3); else artistRef.current?.focus()
                  }}
                  aria-invalid={showErr('title') ? 'true' : undefined}
                  aria-describedby={showErr('title') ? 'err-title' : undefined}
                  placeholder={t('req.titlePh')} />
                {left('title', 160)}
              </div>
              {showErr('title') && <p className="ferr" id="err-title" role="alert">{showErr('title')}</p>}
            </div>
          </div>

          {/* XEM TRƯỚC: đúng cái thẻ mà người khác sẽ thấy trên bảng, dựng từ
              chính những gì đang gõ. Đây là phần trả lời câu hỏi "tôi vừa gửi cái
              gì" TRƯỚC khi bấm Gửi — trước đây phải gửi xong mới biết, và nếu sai
              thì sửa lại tốn thêm một vòng duyệt của admin.
              Chỗ nào chưa điền thì hiện chữ mờ nói rõ còn thiếu gì, nên tấm thẻ này
              vừa là bản xem trước, vừa là danh sách việc cần làm.
              Đứng NGAY DƯỚI hai ô tên bài/nghệ sĩ: đó là chỗ mắt đang ở sau khi gõ
              xong tên bài, và trên màn hình đầu của form — để dưới đáy thì phần lớn
              người dùng không bao giờ cuộn tới nó. */}
          {/* TÁCH TIÊU ĐỀ VIDEO: đứng ngay dưới hai ô vừa gõ (chỗ mắt đang ở),
              TRƯỚC thẻ xem trước — vì đây là việc sửa dữ liệu, không phải việc
              xem lại. */}
          {split && (
            <div className="dup-note split-note" role="status">
              <span className="dup-tx">
                <b>{split.artist} — {split.title}</b>
                <span className="dup-sub">{t('req.splitLead')}</span>
              </span>
              <span className="tags">
                <button type="button" className="btn btn-sm btn-primary" onClick={applySplit}>
                  {t('req.splitGo')}
                </button>
              </span>
            </div>
          )}

          {/* Thẻ này có MỘT chữ làm tên: "Preview". Câu dài cũ
              ("Preview — this is what goes on the board") đã bị gỡ, nhưng bỏ
              luôn cả chữ "Preview" là sai — thẻ có viền nằm dưới hai ô vừa gõ
              mà không có tên thì người dùng phải tự đoán. Con mắt đứng trước
              chữ, và chip xanh hiện thêm khi link YouTube đã được nhận. */}
          <div className="req-preview">
            <div className="rp-bar">
              <Icon name="preview" size={13} />
              <span>{t('req.preview')}</span>
              {ytId && <span className="rp-yt">{t('req.previewYt')}</span>}
            </div>
            <div className="rp-row">
              <span className={`kind ${kindCls(form.kind)}`}>{form.kind}</span>
              <div className="rp-tx">
                <b className={form.artist.trim() ? '' : 'ph'}>
                  {form.artist.trim() || t('req.phArtist')}
                </b>
                <span className="rp-dash" aria-hidden="true">—</span>
                <span className={form.title.trim() ? '' : 'ph'}>
                  {form.title.trim() || t('req.phTitle', { f: titleLabel.toLowerCase() })}
                </span>
                <small className="rp-meta">
                  {userName || t('req.phYou')}
                  <span className="dot dot-inline" aria-hidden="true" />
                  {paid ? t('req.phPaid') : t('req.phFresh')}
                </small>
              </div>
              {ytId && (
                <img className="rp-thumb" src={thumbUrl(ytId, 'mq')} alt=""
                  loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              )}
            </div>
          </div>

          {/* Bài đã có trên bảng: nói ra rồi đưa thẳng tới chỗ vote cho bài đó.
              Đây là gợi ý, KHÔNG phải chặn — người dùng vẫn gửi được nếu họ muốn
              (ví dụ bài cũ đã bị từ chối, hoặc họ muốn một bản khác). */}
          {dup && (
            <div className="dup-note" role="status">
              <span className="dup-tx">
                <b>{dup.title}</b>
                <span className="dup-sub">
                  {dup.open === 0 && dup.pending > 0
                    ? t('req.dupPending', { c: dup.pending })
                    : t('req.dupMeta', { c: dup.rows.length, n: dup.votes })}
                </span>
              </span>
              <span className="tags">
                {dup.best && onVoteExisting && (
                  <button type="button" className="btn btn-sm btn-primary"
                    onClick={() => onVoteExisting(dup.best)}>
                    {t('req.dupVote')}
                  </button>
                )}
                {!dup.best && dup.video && (
                  <a className="btn btn-sm" href={dup.video} target="_blank" rel="noreferrer">
                    {t('req.dupWatch')}
                  </a>
                )}
              </span>
            </div>
          )}
          <div className="field">
            <label htmlFor="rq-link">{t('req.link')}</label>
            <input id="rq-link" value={form.link} onChange={set('link')} onBlur={blur('link')}
              placeholder={t('req.linkPh')} maxLength={500}
              aria-invalid={warnLink ? 'true' : undefined}
              aria-describedby={hasLinkHint ? 'req-link-hint' : undefined} />
            {/* Dòng dưới ô Link chỉ tồn tại khi CÓ điều gì để nói: link sai
                dạng (cảnh báo), link nhận ra được (xác nhận), hoặc link là
                playlist. Câu "để trống cũng được, dán link YouTube nếu có" đã
                bị gỡ (vòng 13) — nhãn ô đã ghi "Song / album link" và chữ
                "Optional" trong nhãn, nói lại lần nữa là thừa. */}
            {hasLinkHint && (
              <p className={warnLink ? 'ferr warn' : 'fhint ok'} id="req-link-hint">
                {warnLink || (ytId ? t('req.linkOk') : t('req.linkList'))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------- BƯỚC 3: GỬI ----------
          Bước quyết định: ghi chú (nếu có) và bài trả phí, rồi gửi. */}
      {step === 3 && (
        <div className="req-pane" key="p3">
          <div className="field note-field">
            {noteOpen ? (
              <>
                <label htmlFor="rq-note">{t('req.note')}</label>
                <textarea id="rq-note" ref={noteRef} value={form.note} onChange={set('note')} maxLength={500}
                  placeholder={t('req.notePh')} />
                <p className="fhint">{t('req.noteHint')}{left('note', 500)}</p>
              </>
            ) : (
              <button type="button" className="note-add" aria-controls="rq-note" onClick={openNote}>
                <Icon name="plus" size={13} />
                {t('req.noteAdd')}
              </button>
            )}
          </div>

          <div className="paidbox">
            <label className="switch" style={{ margin: 0 }}>
              <Check checked={paid} onChange={e => setPaid(e.target.checked)} />
              <span className="t" style={{ margin: 0 }}>{t('req.paidLabel', { p: paidPrice })}</span>
            </label>
            <p style={{ marginTop: 8 }}>
              {t('req.paidDesc1')}<b>{t('req.paidDescB')}</b>{t('req.paidDesc2')}
            </p>
          </div>

          {/* Nguoi gui co quyen biet tin se di dau: mot dong chu ben duoi nut
              gui con thuyet phuc hon cai chuong an trong danh sach. */}
        </div>
      )}

      <p className="am-note">
        {live ? t('req.notifyNote') : t('req.notifyDemo')}
      </p>

      {/* CHÂN FORM — một hàng, thứ tự cố định: quay lại (nếu có) · tiếp/gửi ·
          xoá hết. Nút chính đổi NGHĨA theo bước chứ không đổi chỗ, nên ngón tay
          bấm cùng một điểm suốt cả form. */}
      <div className="req-actions">
        {step > 1 && (
          <button type="button" className="btn req-back" disabled={busy} onClick={back}>
            {t('req.back')}
          </button>
        )}
        {step < 3 ? (
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={next}>
            {t('req.next')}
          </button>
        ) : (
          <button type="submit" className={`btn ${paid ? 'btn-gold' : 'btn-primary'}`}
            style={{ flex: 1 }} disabled={busy}
            title={ready ? undefined : t('req.notReady')}>
            {busy ? t('req.sending')
              : paid ? t('req.submitPaid', { p: usd(PAID_REQUEST.usd) })
                : ready ? t('req.submit') : t('req.submitFix')}
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={clearForm}>{t('req.clear')}</button>
        {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
      </div>

    </form>
  )
}

/* ---------------------------- TAB: VOTE ---------------------------- */
function VoteTab({ rows, myVotes, onVote, voteStatus, goBuy }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('top')

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    /* Up next đã chốt thì khóa vote nên không liệt kê ở đây nữa. */
    let out = rows.filter(r => (r.status === 'queued' || r.status === 'in_progress') && !isPicked(r))
    if (s) out = out.filter(r => `${r.artist} ${r.title}`.toLowerCase().includes(s))
    return sort === 'top'
      ? [...out].sort((a, b) => b.votes - a.votes)
      : [...out].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [rows, q, sort])

  const left = Math.max(0, voteStatus.free_limit - voteStatus.free_used)
  const total = left + voteStatus.credits

  const listRef = useRef(null)
  const pg = usePager(list, VOTE_PER_PAGE, [q, sort])

  return (
    <>
      <div className="card" style={{ marginBottom: 14, padding: 13 }}>
        <div className="vote-status">
          <div className="vs-row">
            <span>{t('vote.freeToday')}</span>
            <b style={{ color: left > 0 ? 'var(--done)' : 'var(--denied)' }}>{left} / {voteStatus.free_limit}</b>
          </div>
          <div className="vs-bar"><i style={{ width: `${(left / voteStatus.free_limit) * 100}%` }} /></div>
          <div className="vs-row">
            <span>{t('vote.purchased')}</span>
            <b style={{ color: 'var(--paid)' }}>{voteStatus.purchased ?? 0}</b>
          </div>
          <div className="vs-row">
            <span>{t('vote.bonus')}</span>
            <b style={{ color: 'var(--a-2)' }}>{voteStatus.bonus ?? 0}</b>
          </div>
        </div>
        {total === 0 && (
          <button className="btn btn-sm" style={{ width: '100%', marginTop: 11 }} onClick={goBuy}>
            {t('vote.outBuy')}
          </button>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={`tab${sort === 'top' ? ' on' : ''}`} onClick={() => setSort('top')}>{t('vote.sortTop')}</button>
          <button className={`tab${sort === 'new' ? ' on' : ''}`} onClick={() => setSort('new')}>{t('vote.sortNew')}</button>
        </div>
        <div className="spacer" />
        <input className="search" placeholder={t('vote.search')} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div ref={listRef} />
      {list.length === 0
        ? <div className="empty">{t('vote.empty')}</div>
        : pg.items.map(r => {
          const mine = myVotes.get(r.id) || 0
          return (
            <div className="adm" key={r.id}>
              <div className="nm">
                <b>
                  {r.title}{' '}
                  {r.is_paid && <span className="pill gold">PAID</span>}
                </b>
                <small>{r.artist} · <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span></small>
              </div>
              <button className={`votebtn${mine > 0 ? ' on' : ''}`} onClick={() => onVote(r)}
                title={t('row.openVote')}>
                <b>{r.votes}</b><span>{t('row.vote')}</span>
                {mine > 0 && <em className="mine">×{mine}</em>}
              </button>
            </div>
          )
        })}
      <Pager {...pg} onChange={pg.setPage} scrollTo={listRef} />
    </>
  )
}

/* ------------------------ TAB: MUA VOTE / TT ------------------------ */
function BuyTab({ onBuy, myOrders, userName, onCancelOrder }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [qty, setQty] = useState(1)
  const [picked, setPicked] = useState(null)

  const buy = async (p, label) => {
    setBusy(p.id); setMsg(null)
    try {
      await onBuy(p)
      setPicked({ usd: p.usd, vnd: p.vnd })
      setMsg({ t: 'ok', m: t('buy.created', { label, amt: vnd(p.vnd) }) })
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
    finally { setBusy(null) }
  }

  const pendingOrder = myOrders.find(o => o.status === 'awaiting')
  const lastOrder = picked
    || (pendingOrder ? { usd: Number(pendingOrder.amount_usd), vnd: pendingOrder.amount_vnd } : null)
  const custom = singlePrice(Math.max(1, Math.min(100, Number(qty) || 1)))
  const best = VOTE_PACKS[VOTE_PACKS.length - 1]
  const saving = (p) => Math.round((1 - (p.usd / p.qty) / SINGLE_VOTE.usd) * 100)
  const orderStatus = (s) => s === 'paid' ? t('order.paid') : s === 'rejected' ? t('order.rejected') : t('order.awaiting')

  return (
    <>
      <h3 className="section-title">{t('buy.packs')}</h3>
      <div className="packs">
        {VOTE_PACKS.map(p => (
          <div className={`pack${p.id === best.id ? ' best' : ''}`} key={p.id}>
            {p.id === best.id && <div className="pack-flag">{t('buy.best')}</div>}
            <b>{p.qty}</b>
            <div className="u">{t('buy.unit')}</div>
            <div className="p">{usd(p.usd)}<small>{vnd(p.vnd)}</small></div>
            {saving(p) > 0 && <div className="pack-save">−{saving(p)}%</div>}
            <button className={`btn btn-sm${p.id === best.id ? ' btn-primary' : ''}`} style={{ width: '100%', marginTop: 10 }}
              disabled={busy === p.id} onClick={() => buy(p, t('order.votes', { n: p.qty }))}>
              {busy === p.id ? '…' : t('buy.order')}
            </button>
          </div>
        ))}
      </div>

      <h3 className="section-title" style={{ marginTop: 20 }}>{t('buy.single')}</h3>
      <div className="buyone">
        <div className="buyone-info">
          <div className="buyone-rate">{usd(SINGLE_VOTE.usd)} <span>{t('buy.perVote')}</span></div>
          <div className="buyone-sub">{t('buy.each', { v: vnd(SINGLE_VOTE.vnd) })}</div>
        </div>
        <div className="qty">
          <button type="button" onClick={() => setQty(q => Math.max(1, Number(q) - 1))}><Icon name="minus" size={14} /></button>
          <input type="number" min="1" max="100" value={qty}
            onChange={e => setQty(e.target.value)}
            onBlur={() => setQty(q => Math.max(1, Math.min(100, Number(q) || 1)))} />
          <button type="button" onClick={() => setQty(q => Math.min(100, Number(q) + 1))}><Icon name="plus" size={14} /></button>
        </div>
        <div className="buyone-total">
          <b>{usd(custom.usd)}</b>
          <span>{vnd(custom.vnd)}</span>
        </div>
        <button className="btn" disabled={busy === 'custom'}
          onClick={() => buy(custom, t('order.votes', { n: custom.qty }))}>
          {busy === 'custom' ? '…' : t('buy.order')}
        </button>
      </div>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <h3 className="section-title" style={{ marginTop: 20 }}>{t('buy.payment')}</h3>
      <div className="pay-note">
        {t('buy.payNote1')}<b>{t('buy.payNoteB')}</b>{t('buy.payNote2')}
      </div>
      <PaymentMethods amountVnd={lastOrder?.vnd ?? 0} amountUsd={lastOrder?.usd ?? 0} content={userName} />

      <h3 className="section-title" style={{ marginTop: 20 }}>{t('buy.yourOrders')}</h3>
      <div className="support">
        {t('support.line')}{' '}
        <a href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer">t.me/{SUPPORT.telegram}</a>
      </div>
      {myOrders.length === 0
        ? <div className="empty">{t('buy.noOrders')}</div>
        : myOrders.slice(0, 12).map(o => (
          <div className="adm" key={o.id}>
            <div className="nm">
              <b>{o.kind === 'votes' ? t('order.votes', { n: o.qty }) : t('order.paidRequest')}</b>
              <small>{usd(o.amount_usd)} · {vnd(o.amount_vnd)}</small>
            </div>
            <span className={`pill ${o.status === 'paid' ? 'completed' : o.status === 'rejected' ? 'denied' : 'pending'}`}>
              {orderStatus(o.status)}
            </span>
            {o.status === 'awaiting' && onCancelOrder && (
              <button className="icon-btn" title={t('order.cancel')} aria-label={t('order.cancel')}
                onClick={() => onCancelOrder(o)}><Icon name="close" size={15} /></button>
            )}
          </div>
        ))}
    </>
  )
}

/* ============================== MODAL ============================== */
export default function ActionModal({
  open, tab, setTab, onClose,
  rows, myVotes, myOrders, voteStatus, allRows, prefill,
  onVote, onSubmit, onBuy, onCancelOrder, userName, onVoteExisting,
  /* live = co noi DB that hay chay demo: RequestTab dung no de chon dong chu bao
     tin. Bo no khoi danh sach prop la `live={live}` ben duoi thanh ReferenceError,
     React go ca cay -> mo "New request" chi con man den. */
  live,
}) {
  const { t } = useI18n()

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const { mounted, closing } = useModalExit(open)
  if (!mounted) return null
  const out = closing ? ' out' : ''
  const votable = rows.filter(r => (r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)).length

  return (
    <div className={`overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${out}`} role="dialog" aria-modal="true" aria-labelledby="am-title">
        <div className="modal-head">
          {/* Hộp này TRƯỚC ĐÂY không có tên: `role="dialog"` mà không có
              `aria-labelledby`/`aria-label` thì trình đọc màn hình chỉ nói
              "hộp thoại" rồi đọc nội dung, người dùng không biết mình vừa mở
              cái gì. Tên lấy từ chính tab đang mở — thứ đang hiện trên màn
              hình — nên không phải đặt thêm một dòng chữ nào. Đây cũng là
              tiêu đề cấp 2 của hộp, để các mục bên trong (h3) có cấp trên. */}
          <h2 className="sr-only" id="am-title">{t(`tab.${tab}`)}</h2>
          <div className="modal-tabs">
            <button className={`mtab${tab === 'request' ? ' on' : ''}`} onClick={() => setTab('request')}>{t('tab.request')}</button>
            <button className={`mtab${tab === 'vote' ? ' on' : ''}`} onClick={() => setTab('vote')}>
              {t('tab.vote')} <span className="c">({votable})</span>
            </button>
            <button className={`mtab${tab === 'buy' ? ' on' : ''}`} onClick={() => setTab('buy')}>{t('tab.buy')}</button>
          </div>
          <button className="x" onClick={onClose} aria-label={t('btn.close')}><Icon name="close" size={15} /></button>
        </div>
        <div className="modal-body">
          {tab === 'request' && (
            <RequestTab onSubmit={onSubmit} live={live} rows={rows} allRows={allRows}
              prefill={prefill} userName={userName} onVoteExisting={onVoteExisting} />
          )}
          {tab === 'vote' && (
            <VoteTab rows={rows} myVotes={myVotes} onVote={onVote}
              voteStatus={voteStatus} goBuy={() => setTab('buy')} />
          )}
          {tab === 'buy' && <BuyTab onBuy={onBuy} myOrders={myOrders} userName={userName} onCancelOrder={onCancelOrder} />}
        </div>
      </div>
    </div>
  )
}