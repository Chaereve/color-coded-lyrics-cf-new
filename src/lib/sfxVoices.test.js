/* ÂM THANH — chốt chặn cho phần "cải tiến sound effect" (vòng 12).
   ---------------------------------------------------------
   Âm thanh là thứ duy nhất trong app không test nào CHẠM tới được: sandbox không
   có loa, cũng không có trình duyệt. Nên hợp đồng ở đây là hợp đồng trên BẢN
   NHẠC và trên ĐƯỜNG DÂY:

     1. ba tiếng mới của vòng 12 (bước tiến · bước lùi · chép link) có mặt, và
        bước tiến đi LÊN còn bước lùi đi XUỐNG — cặp tiếng chỉ có nghĩa khi hai
        chiều nghe khác nhau;
     2. tiếng thông báo đi theo tone của tin: tin trả tiền nghe khác tin thường,
        tin lỗi nghe khác cả hai;
     3. mọi lần phát đều qua `jittered()` — bấm liên tiếp không ra một chuỗi nốt
        giống hệt nhau;
     4. bảng giai điệu gốc (VOICES) vẫn THUẦN: giá trị cao độ không đổi giữa hai
        lần đọc, vì `schedule()` là hàm thuần và phép kiểm khác có thể đọc thẳng
        bảng này.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VOICES, sfx } from './sfx.js'

const src = readFileSync(fileURLToPath(new URL('./sfx.js', import.meta.url)), 'utf8')

const peak = (name) => VOICES[name].reduce((m, n) => Math.max(m, n[3]), 0)
const first = (name) => VOICES[name][0][0]
const last = (name) => VOICES[name][VOICES[name].length - 1][0]

/* ---------- 1. ba tiếng mới ---------- */
test('có tiếng cho bước tiến, bước lùi và chép link', () => {
  for (const k of ['step', 'back', 'copy']) {
    assert.ok(Array.isArray(VOICES[k]) && VOICES[k].length >= 2, `thiếu tiếng \`${k}\``)
    assert.equal(typeof sfx[k], 'function', `thiếu hàm sfx.${k}()`)
  }
  /* Tiến thì cao dần, lùi thì thấp dần: hai chiều phải NGHE ra hai chiều. */
  assert.ok(last('step') > first('step'), 'bước tiến phải đi lên')
  assert.ok(last('back') < first('back'), 'bước lùi phải đi xuống')
  assert.ok(last('copy') > first('copy'), 'tiếng chép link đi lên, gọn')
})

test('tiếng đổi bước rất khẽ — đổi bước là việc lặp, không phải sự kiện đáng mừng', () => {
  for (const k of ['step', 'back', 'copy']) {
    assert.ok(peak(k) <= 0.08, `\`${k}\` phải nhẹ hơn 0,08 (đang ${peak(k)})`)
  }
  assert.ok(peak('submit') > peak('step'), 'tiếng gửi request vẫn là tiếng to nhất trong nhóm này')
})

/* ---------- 2. tiếng thông báo đi theo tone ---------- */
test('tin trả tiền và tin lỗi có tiếng riêng, không dùng chung một tiếng', () => {
  assert.ok(Array.isArray(VOICES.gold), 'thiếu tiếng cho tin trả tiền')
  assert.ok(VOICES.notify.length >= 2)
  /* `sfx.notify` là cửa duy nhất để chọn tiếng: gọi không tham số = tin thường. */
  assert.match(src, /notify:\s*tone => play\(tone === 'gold' \? 'gold' : tone === 'err' \? 'error' : 'notify'\)/,
    'sfx.notify phải chọn tiếng theo tone')
  /* Ba tiếng phải khác nhau về nội dung, không chỉ khác tên. */
  const shape = (k) => VOICES[k].map(n => `${n[0]}:${n[2]}`).join('|')
  assert.notEqual(shape('notify'), shape('gold'))
  assert.notEqual(shape('notify'), shape('error'))
  assert.notEqual(shape('gold'), shape('error'))
})

/* ---------- 3. jitter ---------- */
test('mọi lần phát đều qua jittered(): bấm liên tiếp không ra chuỗi nốt giống hệt', () => {
  const call = src.match(/const play = \(name\) => \{[\s\S]*?\n\}/)?.[0]
  assert.ok(call, 'không tìm thấy hàm play()')
  assert.match(call, /jittered\(seq\)/, 'phải phát qua bản sao có lệch cao độ')
  assert.match(src, /const jittered = \(seq\) =>/, 'phải có hàm tạo bản sao')
  const range = Number(/const JITTER = ([\d.]+)/.exec(src)?.[1])
  assert.ok(range > 0 && range <= 0.01, `độ lệch phải rất nhỏ (đang ${range})`)
})

/* ---------- 4. bảng gốc vẫn thuần ---------- */
test('bảng VOICES là dữ liệu tĩnh, đọc hai lần ra đúng một kết quả', () => {
  const snap = JSON.stringify(VOICES)
  assert.equal(JSON.stringify(VOICES), snap)
  for (const [k, seq] of Object.entries(VOICES)) {
    assert.ok(seq.length > 0, `\`${k}\` rỗng`)
    for (const [f, at, dur, p] of seq) {
      assert.ok(f > 100 && f < 6000, `\`${k}\`: cao độ ${f}Hz nằm ngoài dải nghe được`)
      assert.ok(at >= 0 && dur > 0 && p > 0 && p <= 0.2, `\`${k}\`: nốt ${f}Hz có tham số lạ`)
    }
  }
  /* Tiếng gõ theo nhịp vòng quay KHÔNG đi qua bảng này — nó là xung nhiễu theo
     lịch của dailySpin. Chốt lại để không ai "gộp cho gọn" rồi làm vòng quay
     kêu như tiếng bấm nút. */
  assert.equal(typeof sfx.spinTicks, 'function')
  assert.ok(!('tick' in VOICES), 'tiếng tách của vòng quay không được nằm trong bảng giai điệu')
})
