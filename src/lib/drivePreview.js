/* Only a confirmed clip_not_found response means the clip is absent.
   Deployment/OAuth/network errors must not silently masquerade as a miss. */
const ERROR_KEYS = {
  drive_not_configured: 'preview.driveSetup',
  drive_auth_failed: 'preview.driveAuth',
  drive_access_denied: 'preview.driveAuth',
  drive_rate_limit_unavailable: 'preview.driveService',
  rate_limited: 'preview.driveBusy',
}

export async function findDrivePreview(artist, title, { signal, timeoutMs = 35_000 } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, timeoutMs)
  try {
    const params = new URLSearchParams({ artist, title })
    const response = await fetch(`/api/drive-video/find?${params}`, { signal: controller.signal })
    const result = await response.json().catch(() => null)
    if (response.status === 404 && result?.error === 'clip_not_found') {
      return { status: 'missing', src: '' }
    }
    if (response.ok && typeof result?.url === 'string' && result.url.startsWith('/api/drive-video/stream?')) {
      return { status: 'ready', src: result.url }
    }
    return { status: 'error', src: '', message: ERROR_KEYS[result?.error] || 'preview.driveUnavailable' }
  } catch {
    return { status: 'error', src: '', message: 'preview.driveUnavailable' }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
