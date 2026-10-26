export const HOMEPAGE_VIDEO_LIMIT = 20
export const FEATURED_MEDIA_LIMIT = 1

export const isHomepageVideo = (item) => item?.kind === 'video' || item?.kind === 'playlist'

export const homepageVideoCount = (media) => (media || []).filter(isHomepageVideo).length
export const featuredMediaCount = (media) => (media || []).filter(item => item?.kind === 'featured').length
