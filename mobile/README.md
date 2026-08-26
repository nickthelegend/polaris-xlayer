# Polaris — Android

The borrower's app: your credit line, what you owe, and exactly when the keeper
will collect it.

Expo + expo-router, built against the same design language as the web apps
rather than a phone-shaped reinterpretation of it.

## The theme is ported, not approximated

`apps/core/app/globals.css` authors its palette in `oklch`, which React Native
cannot parse. Every colour in `src/theme/colors.ts` is the sRGB conversion of
the token that produced it, with the original triple kept in a comment so the
two can be diffed when either moves.

One discrepancy in the web stylesheet is preserved rather than smoothed over:
the primary *token* is `oklch(0.88 0.2 128)` → `#B1EF4A`, but the CSS hard-codes
`#A6F24A` everywhere it draws a glow or a ring. Both are here. `primary` is what
buttons and text render; `glow` is what the light around them is made of — the
same relationship the web has.

Three things the web builds with CSS that had to be rebuilt rather than
translated:

**The raised plane.** `.surface` is a wash, a hairline border, and an *inset*
top highlight. React Native has no inset shadow, so `Surface` draws the
highlight as a one-pixel view along its upper edge. That is not a detail worth
skipping — real cards catch light on their top edge, and without it a border
reads as an outline drawn on glass rather than an object above the screen.

**The ground.** A 64px hairline grid faded out downward, plus one lime bloom in
the upper right, both under 5% opacity. This does perceptual work rather than
decoration: a raised plane needs something behind it to read as raised, and near
-black gives it none. Mounted once above the navigator, so it does not move when
you change tabs.

**Money.** Tabular figures everywhere, for the reason the web has a `.figure`
class: a column of money is read down the digits, and proportional numerals make
a changing value shift the ones beside it. A balance that jitters while it
counts reads as broken.

## What is animated, and why

Nothing moves for its own sake. Every animation runs on the UI thread through
Reanimated, so it keeps going while the JS thread is busy — which is exactly
when the screen is on show.

| | |
|---|---|
| The credit orb | Three rings on different axes at different rates. Matched speeds read as one rigid object spinning; mismatched ones read as depth. The arc is a real measurement through the 300–850 band the program enforces. |
| Figures | Count to their value through an `AnimatedTextInput`, so the digits update off the JS thread |
| Presses | Scale, not colour. On a lime button a colour change either disappears or shouts; a scale reads at any brightness |
| Entrances | A 55ms stagger — longer and the last card feels forgotten |
| The schedule ladder | The line is lime where the plan is paid and hairline where it is not, so progress is legible before a number is read |
| Refusals | The amount card shakes. A dead button tells you nothing about why |

One rule the code enforces: **an entrance must never be load-bearing for whether
content is visible.** Every entrance animates from opacity 0, so anything that
stops it running leaves a blank screen. `src/components/motion.ts` guards them,
and hands the decision to the OS reduced-motion setting.

## The numbers are real

`src/data/polaris.ts` is a direct port of `programs/polaris/src/math.rs` —
ceiling division off one canonical ladder, interest annualised and pro-rated
over the term. So the four installments a borrower is quoted at checkout are the
four the keeper will collect, not a UI approximation that drifts by a base unit.

The state itself is a fixture until the wallet is wired. Its values are the ones
the lifecycle script prints against a validator rather than round numbers chosen
to look tidy.

## Running it

```bash
npm install
```

```bash
npx expo run:android
```

`npx expo start` for a dev client on a device.

**A note on the web target.** `npx expo start --web` works and was used to
verify the design, but it is a preview surface, not a supported platform:
Reanimated 4.5 compiles layout animations to CSS on web and does not inject the
keyframes, so entrances are disabled there. The guard in `src/components/motion.ts`
is what stops that rendering an empty screen.

## Status

Typechecks clean under `--noUnusedLocals`, and `expo export --platform android`
produces a 4 MB Hermes bundle. All four screens were verified rendering.

Not yet done, in order of what matters:

1. **The wallet.** Nothing is signed. `payLater` needs to bundle the SPL
   `Approve` and `create_loan` into one transaction — the thing that makes
   checkout a single signature — and `packages/sdk-solana` already does exactly
   that, so this is wiring rather than design.
2. **Live state.** Replace the fixture with `getProgramAccounts`, the same call
   the keeper makes.
3. **Run it on a device.** It has not been on an emulator: the AVD on this
   machine needs 4.2 GB and the system disk had 1.8 GB free. Everything above
   was verified through the bundler and a web render, which catches layout,
   colour and logic but not native shadow, blur or gesture behaviour.
