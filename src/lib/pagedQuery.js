/** Fetch every page of a Supabase/PostgREST query without assuming a response
   cap is the complete dataset. `fetchPage` receives offset and page size and
   returns the standard { data, error } shape. */
export async function fetchAllPages (fetchPage, pageSize = 200) {
  const size = Math.max(1, Math.trunc(Number(pageSize) || 200))
  const rows = []
  let offset = 0

  while (true) {
    const { data, error } = await fetchPage(offset, size)
    if (error) throw error
    const page = Array.isArray(data) ? data : []
    rows.push(...page)
    if (page.length < size) return rows
    offset += page.length
  }
}

/* Read-heavy summaries sometimes have a useful, correctly ordered first page
   even when a later PostgREST page times out. Keep that recent data rather
   than discarding it all; still reject if the first page fails so callers can
   distinguish "no data" from "partial history". */
export async function fetchAvailablePages (fetchPage, pageSize = 200, maxRows = 10000) {
  const size = Math.max(1, Math.trunc(Number(pageSize) || 200))
  const cap = Math.max(size, Math.trunc(Number(maxRows) || 10000))
  const rows = []
  let offset = 0

  while (rows.length < cap) {
    let result
    try { result = await fetchPage(offset, Math.min(size, cap - rows.length)) }
    catch (error) {
      if (rows.length) return rows
      throw error
    }
    if (result?.error) {
      if (rows.length) return rows
      throw result.error
    }
    const page = Array.isArray(result?.data) ? result.data : []
    rows.push(...page.slice(0, cap - rows.length))
    if (page.length < size) return rows
    offset += page.length
  }
  return rows
}
