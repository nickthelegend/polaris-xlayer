import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @polarispay/db is a workspace package compiled from TS source; Next has to
  // treat it as first-party or the data routes cannot resolve it.
  transpilePackages: ["@polarispay/db"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'logo.clearbit.com',
      },
      {
        protocol: 'https',
        hostname: 'fonts.gstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'github.githubassets.com',
      },
      {
        protocol: 'https',
        hostname: 'www.adobe.com',
      },
      { protocol: 'https', 
        hostname: 'upload.wikimedia.org' },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },

  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
      buffer: require.resolve("buffer"),
    };

    // Required for @zama-fhe/relayer-sdk WASM module (webpack fallback)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Stub out React Native / non-browser transitive deps that can't be
    // resolved in a web build. These are pulled in by @metamask/sdk (via
    // RainbowKit), @privy-io/react-auth
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
      '@farcaster/mini-app-solana': false,
      // @wagmi/core's Tempo connector and the mongodb driver both guard these
      // behind optional dynamic imports and handle the failure themselves, but
      // webpack still tries to resolve them at build time and fails the whole
      // compile. Aliasing to false lets the runtime guards do their job.
      accounts: false,
      aws4: false,
    };

    return config;
  },
}

export default nextConfig
