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
