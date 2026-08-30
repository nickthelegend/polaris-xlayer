import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Haptics that stay quiet on the web build.
 *
 * expo-haptics maps to `navigator.vibrate`, which Chrome refuses — and logs as
 * a console error — until the frame has had a real user gesture. A browser was
 * never going to buzz anyway, so it is not asked to.
 *
 * One module with a platform check rather than a `.web.ts` sibling: the split
 * relies on the bundler's platform resolution, and when that did not take, the
 * calls went through silently. This cannot not take.
 */
const silent = Platform.OS === "web";

export const tap = () => {
  if (silent) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export const press = () => {
  if (silent) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
};

/** A selection change: lighter than a tap, used when a choice moves. */
export const selected = () => {
  if (silent) return;
  void Haptics.selectionAsync();
};

export const succeeded = () => {
  if (silent) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

export const failed = () => {
  if (silent) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
