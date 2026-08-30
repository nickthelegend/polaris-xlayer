import { Platform } from "react-native";
import { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";

import { motion } from "../theme";

/**
 * Entrance animations, guarded.
 *
 * Two rules, and the first is the important one:
 *
 * **An entrance must never be load-bearing for whether content is visible.**
 * Every one of these animates from opacity 0, so anything that stops the
 * animation running leaves a blank screen rather than an unanimated one. That
 * is not a hypothetical: Reanimated's layout animations are native on Android
 * and iOS, but on web they compile to CSS animations, and 4.5 sets
 * `animation-name: FadeInDown` without ever injecting the matching `@keyframes`.
 * The element holds its from-state forever and the whole screen renders empty.
 *
 * Web is a preview surface for this app, not a target — but a screen that can
 * render blank is worth designing out rather than working around, so the
 * entrance is dropped wherever it cannot be trusted to finish.
 *
 * **Second: motion is a preference.** `ReduceMotion.System` hands the decision
 * to the OS setting, so a user who has asked for less movement gets content
 * that appears rather than content that slides.
 */
const supported = Platform.OS !== "web";

/** A card arriving. `index` staggers a list without each caller doing the maths. */
export const enterUp = (index = 0) =>
  supported
    ? FadeInDown.delay(index * motion.stagger)
        .duration(motion.duration.slow)
        .reduceMotion(ReduceMotion.System)
    : undefined;

/** A delay in milliseconds rather than a stagger index. */
export const enterUpAfter = (delayMs: number) =>
  supported
    ? FadeInDown.delay(delayMs)
        .duration(motion.duration.slow)
        .reduceMotion(ReduceMotion.System)
    : undefined;

/** A plain fade, for content that should not also move. */
export const enterFade = (delayMs = 0) =>
  supported
    ? FadeIn.delay(delayMs)
        .duration(motion.duration.base)
        .reduceMotion(ReduceMotion.System)
    : undefined;
