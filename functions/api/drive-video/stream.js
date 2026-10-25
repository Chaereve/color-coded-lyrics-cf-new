import { driveVideoStreamRoute } from '../../../worker/driveVideo.js'

export async function onRequest(context) {
  return driveVideoStreamRoute(context.request, context.env)
}
