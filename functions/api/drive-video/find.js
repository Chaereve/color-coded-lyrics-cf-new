import { driveVideoFindRoute } from '../../../worker/driveVideo.js'

export async function onRequest(context) {
  return driveVideoFindRoute(context.request, context.env)
}
