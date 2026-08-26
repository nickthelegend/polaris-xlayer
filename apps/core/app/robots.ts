import type { MetadataRoute } from "next"

import { BASE_URL } from "./sitemap"

/**
 * The sitemap URL is imported rather than repeated. It previously named
 * pay-ease-ruby.vercel.app, a different project's deployment, so a crawler
 * following it left this site entirely.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
