// Live link checking for the K-pop question bank.
//
// The logic lives in its own module so it can be unit-tested with a stub
// `fetch`: the CI sandbox has no outbound network, but every HTTP scenario
// (redirects, dead links, soft-404s, blocks) still has to be verified.
//
// Field semantics this module produces:
//   initialStatus  status returned by the originally requested URL
//   finalStatus    status returned by the final resolved URL
//   finalUrl       final canonical URL after redirects
//   redirectCount  number of redirects followed from the requested URL
//   accessStatus   public_accessible | accessible_with_redirect | dead |
//                  blocked | retry_required | soft_404 | network_unavailable
//
// HTTP 200 alone never means "valid": the body still has to be a real page and
// still has to contain the fact tokens (see factMatch).

export const ACCESS_OK = ['public_accessible', 'accessible_with_redirect']

export const SOFT404_TEXT = /(page (?:not found|could not be found|unavailable)|content (?:is )?(?:unavailable|removed|no longer available)|this (?:page|video) (?:is|has been) (?:unavailable|removed)|video unavailable|no results|we couldn't find|enable javascript|just a moment|are you a robot|captcha|sign in to continue|log in to continue|subscribe to continue|access denied)/i

export const BAD_REDIRECT_TARGET = /\/(?:search|results?|login|signin|sign-in|apps?|store|country|region|home)(?:\/|\?|$)/i

export function factMatch (text, tokens) {
  const list = [...new Set(tokens.filter(Boolean).map(t => t.toLowerCase()))]
  const lower = String(text ?? '').toLowerCase()
  const hits = list.filter(t => lower.includes(t))
  if (!list.length) return { match: 'fail', hits: [], note: 'no fact token supplied' }
  const pass = hits.length >= Math.ceil(list.length / 2)
  return {
    match: pass ? 'pass' : 'fail',
    hits,
    note: hits.length ? `matched tokens: ${hits.slice(0, 8).join(', ')}` : 'no required token found'
  }
}

export function createLinkChecker (cfg, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  const pause = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const robotsCache = new Map()

  async function robotsAllowed (url) {
    if (!cfg.respectRobots) return { allowed: true, note: 'robots check disabled' }
    const { origin, pathname } = new URL(url)
    // Cache the parsed rules per origin, never the verdict: a verdict depends
    // on the path, so caching it would leak one path's answer onto another.
    let rules = robotsCache.get(origin)
    if (!rules) {
      rules = await loadRobots(origin)
      robotsCache.set(origin, rules)
    }
    if (rules.error) return { allowed: true, note: rules.error }
    for (const rule of rules.disallow) {
      if (rule === '/' || pathname.startsWith(rule)) return { allowed: false, note: `robots disallow ${rule}` }
    }
    return { allowed: true, note: 'robots allows this path' }
  }

  async function loadRobots (origin) {
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { 'user-agent': cfg.userAgent },
        signal: AbortSignal.timeout(cfg.timeoutMs)
      })
      if (!res.ok) return { disallow: [], error: `robots.txt returned ${res.status}` }
      const body = await res.text()
      const groups = []
      let current = null
      for (const line of body.split(/\r?\n/)) {
        const clean = line.replace(/#.*$/, '').trim()
        if (!clean) continue
        const [key, ...rest] = clean.split(':')
        const value = rest.join(':').trim()
        if (/^user-agent$/i.test(key)) {
          current = { agents: [value.toLowerCase()], rules: [] }
          groups.push(current)
        } else if (/^(disallow|allow)$/i.test(key) && current) {
          current.rules.push({ type: key.toLowerCase(), path: value })
        }
      }
      const relevant = groups.filter(g => g.agents.includes('*') || g.agents.some(a => a.includes('kpopquizvalidator')))
      const disallow = relevant.flatMap(g => g.rules.filter(r => r.type === 'disallow' && r.path).map(r => r.path))
      return { disallow, error: null }
    } catch (e) {
      // If robots.txt cannot be read we do not assume permission is missing;
      // the request itself is still subject to every other check.
      return { disallow: [], error: `robots check failed (${e.message})` }
    }
  }

  async function fetchPage (url) {
    const chain = []
    const visited = new Set([url])
    let current = url
    let initialStatus = null
    let finalStatus = null
    let finalResponse = null

    for (let hop = 0; hop <= cfg.maxRedirects + 1; hop++) {
      let response = null
      let lastError = null
      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
          response = await fetchImpl(current, {
            redirect: 'manual',
            signal: AbortSignal.timeout(cfg.timeoutMs),
            headers: {
              'user-agent': cfg.userAgent,
              accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'accept-language': 'en-US,en;q=0.9'
            }
          })
          break
        } catch (e) {
          lastError = e
          if (attempt < cfg.maxRetries) await pause(cfg.retryBaseDelayMs * (attempt + 1))
        }
      }
      if (!response) {
        return {
          initialStatus,
          finalStatus,
          finalUrl: current,
          chain,
          redirectCount: chain.length,
          html: '',
          title: '',
          text: '',
          accessStatus: 'network_unavailable',
          temporaryRedirect: false,
          note: `network error: ${lastError?.message}`
        }
      }
      if (initialStatus === null) initialStatus = response.status
      finalStatus = response.status
      finalResponse = response
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).toString()
        chain.push({ from: current, to: next, status: response.status })
        if (visited.has(next)) {
          return {
            initialStatus,
            finalStatus,
            finalUrl: next,
            chain,
            redirectCount: chain.length,
            html: '',
            title: '',
            text: '',
            accessStatus: 'blocked',
            temporaryRedirect: false,
            note: 'redirect loop'
          }
        }
        visited.add(next)
        if (chain.length > cfg.maxRedirects) {
          return {
            initialStatus,
            finalStatus,
            finalUrl: next,
            chain,
            redirectCount: chain.length,
            html: '',
            title: '',
            text: '',
            accessStatus: 'blocked',
            temporaryRedirect: false,
            note: `redirect chain longer than ${cfg.maxRedirects}`
          }
        }
        current = next
        continue
      }
      break
    }

    if (finalStatus >= 400) {
      let accessStatus = 'retry_required'
      if (finalStatus === 404 || finalStatus === 410) accessStatus = 'dead'
      else if (finalStatus === 401 || finalStatus === 403) accessStatus = 'blocked'
      return {
        initialStatus,
        finalStatus,
        finalUrl: current,
        chain,
        redirectCount: chain.length,
        html: '',
        title: '',
        text: '',
        accessStatus,
        temporaryRedirect: false,
        note: `final HTTP ${finalStatus}`
      }
    }

    const html = await finalResponse.text().catch(() => '')
    const title = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
    const temporaryRedirect = chain.some(step => step.status === 302 || step.status === 307)

    if (chain.length) {
      const last = chain[chain.length - 1]
      if (BAD_REDIRECT_TARGET.test(last.to) || new URL(last.to).pathname === '/') {
        return {
          initialStatus,
          finalStatus,
          finalUrl: current,
          chain,
          redirectCount: chain.length,
          html,
          title,
          text: '',
          accessStatus: 'blocked',
          temporaryRedirect,
          note: 'redirect target is a generic page'
        }
      }
    }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')

    if (text.trim().length < cfg.minBodyChars) {
      return {
        initialStatus,
        finalStatus,
        finalUrl: current,
        chain,
        redirectCount: chain.length,
        html,
        title,
        text,
        accessStatus: 'soft_404',
        temporaryRedirect,
        note: 'page body is empty or a shell'
      }
    }
    if (SOFT404_TEXT.test(text.slice(0, 8000))) {
      return {
        initialStatus,
        finalStatus,
        finalUrl: current,
        chain,
        redirectCount: chain.length,
        html,
        title,
        text,
        accessStatus: 'soft_404',
        temporaryRedirect,
        note: 'soft-404 or interstitial marker found'
      }
    }

    return {
      initialStatus,
      finalStatus,
      finalUrl: current,
      chain,
      redirectCount: chain.length,
      html,
      title,
      text,
      accessStatus: chain.length ? 'accessible_with_redirect' : 'public_accessible',
      temporaryRedirect,
      note: temporaryRedirect ? 'content retrieved after a temporary redirect' : 'content retrieved'
    }
  }

  return { robotsAllowed, fetchPage }
}
