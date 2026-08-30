# Release artifacts

`polaris-0.1.0-universal.apk` is **not tracked**: it is a 71MB build artifact
that would be rewritten every release and kept in git history forever.

The Vercel CLI uploads the working directory, so `vercel --prod` from here
ships whatever APK is present. A GitHub-integrated deploy would **not** — if
this project ever moves to one, publish the APK to a GitHub Release and point
`app/download/page.tsx` at that URL instead.

Rebuild it with `cd ../../polaris-solana/mobile && npx expo run:android --variant release`.
