/* Client cũ gặp 5 RPC đã bị revoke (20261122) thì phải nhận một câu xử lý được,
   không phải text Postgres.
   -----------------------------------------------------------------------------
   Bundle cũ còn nằm trong cache trình duyệt vẫn gọi start_daily_quiz /
   submit_daily_quiz_answer / submit_daily_quiz / my_daily_rewards_status /
   claim_daily_login; sau khi 20261122 revoke quyền, PostgREST trả SQLSTATE 42501
   với message "permission denied for function <tên>". Bài kiểm này chốt:
     · cả năm tên hàm đều đi vào đúng một câu mời nạp lại trang;
     · câu đó có chữ "refresh" và không lộ quiz/tên hàm/SQLSTATE;
     · lỗi quyền trên TABLE/RELATION/RLS và mọi lỗi khác giữ nguyên hành vi cũ
       (không bị gán nhầm thành "tính năng đã nghỉ hưu").
   Chạy qua Vite để dùng đúng module i18n của app, nhưng không kết nối mạng. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const RETIRED_RPC = [
  'start_daily_quiz',
  'submit_daily_quiz_answer',
  'submit_daily_quiz',
  'my_daily_rewards_status',
  'claim_daily_login',
]

test('client cũ nhận lỗi quyền trên RPC đã revoke thì được mời nạp lại trang', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-retired-client-test',
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { errMsg, translate } = await server.ssrLoadModule('/src/lib/i18n.jsx')

    /* PostgREST: 403 + {"code":"42501","message":"permission denied for function …"} */
    for (const rpc of RETIRED_RPC) {
      const shown = errMsg(translate, {
        code: '42501',
        message: `permission denied for function ${rpc}`,
        details: null,
        hint: null,
      })
      assert.equal(shown, translate('err.featureRetiredClient'), `${rpc} phải đi vào câu mời nạp lại`)
      assert.match(shown, /refresh/i, `${rpc}: câu hiển thị phải nói rõ cần nạp lại trang`)
      assert.doesNotMatch(shown, /quiz|permission denied|SQLSTATE|42501|_|err\./i,
        `${rpc}: không được lộ chi tiết Postgres hay tên hàm`)
    }

    /* P0001 + 'err.xxx' (đường raise của SQL) vẫn dịch như cũ. */
    assert.equal(errMsg(translate, { code: 'P0001', message: 'err.dailyLoginRewardImmutable' }),
      translate('err.dailyLoginRewardImmutable'))
    assert.notEqual(errMsg(translate, { code: 'P0001', message: 'err.commentDeleteDenied' }),
      translate('err.featureRetiredClient'))

    /* Lỗi quyền KHÔNG thuộc nhóm RPC nghỉ hưu: giữ nguyên hành vi cũ. */
    for (const other of [
      { code: '42501', message: 'permission denied for table request_comments' },
      { code: '42501', message: 'permission denied for relation votes' },
      { code: '42501', message: 'permission denied for schema public' },
      { code: '42501', message: 'insufficient privilege' },
      { code: '42501', message: 'new row violates row-level security policy for table "votes"' },
      { code: 'PGRST301', message: 'JWT expired' },
      { message: 'TypeError: Failed to fetch' },
    ]) {
      const shown = errMsg(translate, other)
      assert.notEqual(shown, translate('err.featureRetiredClient'), `${other.message} bị gán nhầm thành nghỉ hưu`)
      assert.doesNotMatch(shown, /permission denied|SQLSTATE|42501/i, `${other.message} còn lộ text Postgres`)
      assert.ok(shown.length > 0 && shown.length < 200, `${other.message} phải là câu ngắn hiển thị được`)
    }
  } finally {
    await server.close()
  }
})
