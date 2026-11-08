/** Umami website ID from stats.gousse.cool. Analytics stay off while it is empty. */
const UMAMI_WEBSITE_ID = 'ad001734-85ec-46c8-81ed-d123a2f7e6b2'

/** Umami counts page views itself, including client-side navigation, and sets no cookies. */
export const analyticsScripts = UMAMI_WEBSITE_ID
  ? [
      {
        src: 'https://stats.gousse.cool/script.js',
        defer: true,
        'data-website-id': UMAMI_WEBSITE_ID,
        'data-domains': 'oot.gousse.cool',
      },
    ]
  : []
