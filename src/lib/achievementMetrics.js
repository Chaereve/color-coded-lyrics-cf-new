import { achievementRank } from './ranking.js'
import { isRewardEligibleRequest, requestWorkKey } from './requestEligibility.js'

/** Progress values shown beside the server-authoritative achievement catalog.
   The orders argument must be the complete user-scoped order history; fetchOrders
   paginates so a 200-row page cap cannot understate settled paid requests. */
export function achievementRequestMetrics (requests, orders, ranking, userId) {
  const settledPaidRequests = new Set((orders || [])
    .filter(order => userId != null && String(order?.user_id) === String(userId)
      && order.kind === 'paid_request'
      && order.status === 'paid'
      && order.request_id != null)
    .map(order => String(order.request_id)))
  const works = new Map()

  for (const request of requests || []) {
    if (!isRewardEligibleRequest(request)) continue
    const key = requestWorkKey(request)
    let work = works.get(key)
    if (!work) works.set(key, work = { completed: false, paid: false })
    work.completed ||= request.status === 'completed'
    work.paid ||= request.id != null
      && request.is_paid === true
      && request.payment_status === 'paid'
      && settledPaidRequests.has(String(request.id))
  }

  const grouped = [...works.values()]
  return {
    requests: grouped.length,
    completed: grouped.filter(work => work.completed).length,
    paidRequests: grouped.filter(work => work.paid).length,
    rank: achievementRank(ranking, userId),
  }
}
