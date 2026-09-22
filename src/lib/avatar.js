/* =========================================================
   XỬ LÝ ẢNH ĐẠI DIỆN
   ---------------------------------------------------------
   Mặc định: thu nhỏ ảnh ngay trên trình duyệt rồi lưu thẳng
   vào cột profiles.avatar_url dưới dạng data URI.
   → không tốn ô Storage nào của Supabase, không cần cấu hình.

   Tuỳ chọn: nếu .env có VITE_CLOUDINARY_CLOUD + VITE_CLOUDINARY_PRESET
   thì ảnh được đẩy lên Cloudinary (free 25GB) và chỉ lưu lại URL.
   ========================================================= */

export const AVATAR_PX = 128          // đủ nét cho mọi chỗ hiển thị (to nhất 26px @3x)
export const AVATAR_QUALITY = 0.72
export const MAX_FILE_MB = 8

const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD
const PRESET = import.meta.env.VITE_CLOUDINARY_PRESET
export const usesCloudinary = !!(CLOUD && PRESET)

/* code là key trong từ điển (err.*), vars để điền {mb}… — errMsg(t, e) dịch ra chữ */
const err = (code, vars) => Object.assign(new Error(code), { code, vars })

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_DIMENSION = 4096

/** MIME headers are attacker-controlled, so check the file signature too. */
async function hasRasterSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const starts = (...values) => values.every((v, i) => bytes[i] === v)
  return (file.type === 'image/jpeg' && starts(0xff, 0xd8, 0xff))
    || (file.type === 'image/png' && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    || (file.type === 'image/gif' && starts(0x47, 0x49, 0x46, 0x38))
    || (file.type === 'image/webp' && starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
}

export async function validateImageFile(file) {
  checkFile(file)
  if (!(await hasRasterSignature(file))) throw err('err.avatarType')
}

/** Đọc file thành HTMLImageElement (kèm URL blob để hiển thị lúc chỉnh khung) */
export async function loadImage(file) {
  await validateImageFile(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight ||
          img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION) {
        URL.revokeObjectURL(url)
        reject(err('err.avatarRead'))
        return
      }
      resolve({ img, url })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(err('err.avatarRead')) }
    img.src = url
  })
}

/**
 * Vùng cắt mặc định: hình vuông lớn nhất nằm giữa ảnh.
 * @returns {{sx:number, sy:number, size:number}} toạ độ theo pixel của ảnh gốc
 */
export function centerCrop(img) {
  const size = Math.min(img.naturalWidth, img.naturalHeight)
  return { sx: (img.naturalWidth - size) / 2, sy: (img.naturalHeight - size) / 2, size }
}

/**
 * Vẽ đúng vùng đã chọn ra canvas AVATAR_PX × AVATAR_PX rồi nén lại.
 * @param {HTMLImageElement} img
 * @param {{sx:number, sy:number, size:number}} crop  vùng cắt theo pixel ảnh gốc
 */
export async function renderCrop(img, crop) {
  const { sx, sy, size } = crop
  if (!size) throw err('err.avatarRead')

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw err('err.avatarRead')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX)

  // WebP nhẹ hơn JPEG ~20%; trình duyệt nào không hỗ trợ thì tự rơi về JPEG
  const type = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise(r => canvas.toBlob(r, type, AVATAR_QUALITY))
  if (!blob) throw err('err.avatarRead')
  return blob
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(fr.result)
  fr.onerror = () => reject(err('err.avatarRead'))
  fr.readAsDataURL(blob)
})

export async function toCloudinary(blob) {
  const fd = new FormData()
  fd.append('file', blob)
  fd.append('upload_preset', PRESET)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: fd })
  if (!res.ok) throw err('err.avatarUpload')
  const json = await res.json()
  let uploaded
  try { uploaded = new URL(json.secure_url) } catch { throw err('err.avatarUpload') }
  if (uploaded.protocol !== 'https:' || !uploaded.hostname.endsWith('.cloudinary.com')) {
    throw err('err.avatarUpload')
  }
  return uploaded.href
}

/**
 * GIF và animated WebP phải đi thẳng qua, không qua canvas: vẽ/cắt canvas chỉ giữ frame đầu
 * và đổi nó thành WebP/JPEG tĩnh, nên làm vậy sẽ mất chuyển động.
 * Giữ nguyên blob (hoặc đưa nguyên blob lên Cloudinary) để trình duyệt phát animation.
 */
export async function isAnimatedWebp(file) {
  if (!file || file.type !== 'image/webp') return false
  try {
    const buffer = await file.slice(0, 64).arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      const fourcc = String.fromCharCode(...bytes.slice(12, 16))
      if (fourcc === 'VP8X') {
        return (bytes[20] & 0x02) !== 0
      }
    }
  } catch {}
  return false
}

export async function processAnimatedAvatar(file) {
  if (!file || (file.type !== 'image/gif' && file.type !== 'image/webp')) throw err('err.avatarType')
  if (file.size > (usesCloudinary ? MAX_FILE_MB : 2.5) * 1024 * 1024) throw err('err.avatarBig')
  await validateImageFile(file)
  const url = usesCloudinary ? await toCloudinary(file) : await blobToDataUrl(file)
  return { url, bytes: file.size, hosted: usesCloudinary }
}

/** Kiểm tra nhanh file người dùng chọn trước khi đọc bytes/ảnh. */
export function checkFile(file) {
  if (!file) throw err('err.avatarRead')
  if (!RASTER_TYPES.has(file.type)) throw err('err.avatarType')
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw err('err.avatarBig')
}

/**
 * Cắt theo vùng đã chọn rồi trả về chuỗi lưu được vào avatar_url.
 * @returns {Promise<{ url: string, bytes: number, hosted: boolean }>}
 */
export async function processAvatar(img, crop) {
  const blob = await renderCrop(img, crop)
  if (usesCloudinary) {
    return { url: await toCloudinary(blob), bytes: blob.size, hosted: true }
  }
  return { url: await blobToDataUrl(blob), bytes: blob.size, hosted: false }
}
