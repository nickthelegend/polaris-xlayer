import type { MetadataRoute } from "next"

/**
 * The sitemap is a list of routes that exist.
 *
 * This one advertised /checkout, /transactions and /settings -- none of which
 * are routes in this app, all three 404 -- while omitting /merchants, /faucet,
 * /docs and /plans, which are. It also pointed at pay-ease-ruby.vercel.app, a
 * different project's deployment. A sitemap that names pages the crawler cannot
 * fetch is worse than none: it spends the crawl budget proving the site is
 * broken.
 *
 * Derived from one list so a new route cannot be added without appearing here.
 */
const ROUTES = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/plans", changeFrequency: "daily", priority: 0.9 },
  { path: "/limits", changeFrequency: "weekly", priority: 0.8 },
  { path: "/merchants", changeFrequency: "weekly", priority: 0.8 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.7 },
  { path: "/faucet", changeFrequency: "monthly", priority: 0.5 },
] as const

export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://polarispay.xyz"

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }))
}
