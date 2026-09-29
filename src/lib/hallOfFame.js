import { groupKey } from './board.js'
import { parseYoutube } from './youtubeUrl.js'

/* Public Hall of Fame contains completed work, one row per video/song group,
   newest completion first. Keep the cap here so renderers cannot accidentally
   turn the home page into an unbounded archive. */
export function buildHallOfFame(rows, limit = 5) {
  const requested = Number(limit)
  const max = Number.isFinite(requested) ? Math.min(5, Math.max(0, Math.trunc(requested))) : 5
  if (!max) return []
  const sorted = (rows || [])
    .filter(r => r?.status === 'completed' && r.video_url)
    .slice()
    .sort((a, b) => new Date(b.completed_at || b.updated_at || b.created_at) - new Date(a.completed_at || a.updated_at || a.created_at))
  const seen = new Map()
  for (const r of sorted) {
    const ytId = parseYoutube(r.video_url)?.id
    const key = ytId ? `yt:${ytId}` : groupKey(r)
    if (!seen.has(key)) {
      seen.set(key, { ...r, requesters: [r.requester].filter(Boolean), totalVotes: Number(r.votes || 0), count: 1 })
    } else {
      const item = seen.get(key)
      item.count += 1
      item.totalVotes += Number(r.votes || 0)
      if (r.requester && !item.requesters.includes(r.requester)) item.requesters.push(r.requester)
    }
  }
  return Array.from(seen.values()).slice(0, max)
}
