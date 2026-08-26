import path from "node:path";

import type { NextConfig } from "next";

const nextConfig = {
  // Turbopack will not follow a workspace symlink that points outside its
  // inferred root, so @polarispay/db resolves to nothing and every data route
  // 500s with "Module not found". Pointing the root at the monorepo fixes it.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // @polarispay/db ships TypeScript source rather than a build step, so Next
  // has to compile it like first-party code. Without this the workspace import
  // resolves to nothing and every data route 500s with "Module not found".
  transpilePackages: ["@polarispay/db"],
  typescript: {
    // Type errors now fail the build (the app typechecks clean).
    ignoreBuildErrors: false,
  },
  // There is deliberately no CORS block here.
  //
  // /api/:path* used to send Access-Control-Allow-Origin: * together with
  // Access-Control-Allow-Credentials: true, and x-wallet-address was on the
  // allowed-header list. /api/merchant/overview authenticates on nothing but
  // that header, so any page on the internet could send one and read a
  // merchant's entire ledger -- every plan, every balance, every payout -- with
  // the browser reading the response back out to the attacker.
  //
  // Everything that calls this API is served from this same origin, so no CORS
  // headers are needed at all and the same-origin policy does the work. If a
  // cross-origin consumer is ever added, give it an explicit origin allowlist
  // and real authentication, never a wildcard.
};

export default nextConfig;

