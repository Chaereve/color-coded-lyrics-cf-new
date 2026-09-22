/* XỬ LÝ ẢNH ĐẠI DIỆN: chỉ ảnh tĩnh (JPG, PNG, WebP). */
export const AVATAR_PX = 128
export const AVATAR_QUALITY = 0.72
export const MAX_FILE_MB = 8

const ENV = import.meta.env || {}
const CLOUD = ENV.VITE_CLOUDINARY_CLOUD
const PRESET = ENV.VITE_CLOUDINARY_PRESET
export const usesCloudinary = !!(CLOUD && PRESET)
const err = (code, vars) => Object.assign(new Error(code), { code, vars })
const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_DIMENSION = 4096

async function hasRasterSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const starts = (...values) => values.every((v, i) => bytes[i] === v)
  return (file.type === 'image/jpeg' && starts(0xff, 0xd8, 0xff))
    || (file.type === 'image/png' && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    || (file.type === 'image/webp' && starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
}

export async function validateImageFile(file) {
  checkFile(file)
  if (!(await hasRasterSignature(file))) throw err('err.avatarType')
}

export async function loadImage(file) {
  await validateImageFile(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION) {
        URL.revokeObjectURL(url); reject(err('err.avatarRead')); return
      }
      resolve({ img, url })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(err('err.avatarRead')) }
    img.src = url
  })
}

export function centerCrop(img) {
  const size = Math.min(img.naturalWidth, img.naturalHeight)
  return { sx: (img.naturalWidth - size) / 2, sy: (img.naturalHeight - size) / 2, size }
}

export async function renderCrop(img, crop) {
  const { sx, sy, size } = crop
  if (!size) throw err('err.avatarRead')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw err('err.avatarRead')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX)
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
  const fd = new FormData(); fd.append('file', blob); fd.append('upload_preset', PRESET)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: fd })
  if (!res.ok) throw err('err.avatarUpload')
  const json = await res.json()
  let uploaded
  try { uploaded = new URL(json.secure_url) } catch { throw err('err.avatarUpload') }
  if (uploaded.protocol !== 'https:' || !uploaded.hostname.endsWith('.cloudinary.com')) throw err('err.avatarUpload')
  return uploaded.href
}

export function checkFile(file) {
  if (!file) throw err('err.avatarRead')
  if (!RASTER_TYPES.has(file.type)) throw err('err.avatarType')
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw err('err.avatarBig')
}

export async function processAvatar(img, crop) {
  const blob = await renderCrop(img, crop)
  return { url: usesCloudinary ? await toCloudinary(blob) : await blobToDataUrl(blob), bytes: blob.size, hosted: usesCloudinary }
}
