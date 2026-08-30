// Side-effect import, and it has to be first: web3.js needs Buffer and
// getRandomValues installed before anything constructs a PublicKey or a
// Keypair, and module evaluation order follows import order.
import "../src/chain/polyfills";

import {
  JetBrainsMono_400Regular, JetBrainsMono_500Medium
} from "@expo-google-fonts/jetbrains-mono";
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, useFonts
} from "@expo-google-fonts/space-grotesk";
import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PolarisProvider } from "../src/chain/provider";
import { useIncomingRequest } from "../src/chain/useIncomingRequest";
import { ink, palette } from "../src/theme";

/**
 * The navigator paints its own background behind every screen, and its default
 * is the light theme — `rgb(242, 242, 242)`. Without this it lays a light grey
 * plate over the ambient ground on every platform, and the whole app renders as
 * white-on-white.
 *
 * These come from `expo-router`, not from `@react-navigation/native`. Since SDK
 * 56 expo-router vendors its own copy and hard-errors the build if you import
 * the upstream package directly.
 *
 * `background` and `card` are transparent on purpose: the ground is mounted
 * once above the navigator, and anything the navigator paints would cover it.
 */
const polarisTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: palette.primary,
    background: "transparent",
    card: "transparent",
    text: palette.foreground,
    border: ink.hairline,
    notification: palette.primary,
  },
  fonts: DarkTheme.fonts,
};

/**
 * How long the app will wait for webfonts before rendering without them.
 * Long enough that a normal load wins the race; short enough that a stalled
 * one is a slightly plainer app rather than a black rectangle.
 */
const FONT_GRACE_MS = 2500;

SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — not worth failing a launch over */
});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  /*
   * The font gate must not be load-bearing for whether the app renders.
   *
   * `useFonts` reports success and failure, but it has a third outcome with no
   * signal at all: neither. When that happens `!loaded && !error` stays true
   * forever and this component returns null for the life of the process — a
   * black screen, no crash, no redbox, `Running "main"` in the log and nothing
   * on the glass. That is exactly what a Galaxy S24 Ultra did on this build.
   *
   * This is the same rule `src/components/motion.ts` already applies to
   * entrances: an async step may improve the screen, never decide whether the
   * screen exists. So the gate now expires. After `FONT_GRACE_MS` the app
   * renders regardless, in the platform's own sans and mono, and the real
   * faces swap in if they ever arrive.
   */
  const [fontGraceExpired, setFontGraceExpired] = useState(false);

  // A Solana Pay code can open the app cold, so this listens above the router.
  useIncomingRequest();

  useEffect(() => {
    if (loaded || error) return;
    const t = setTimeout(() => setFontGraceExpired(true), FONT_GRACE_MS);
    return () => clearTimeout(t);
  }, [loaded, error]);

  useEffect(() => {
    // Hide on error and on expiry as well as success. A font that failed to
    // load is a worse app; a splash screen that never goes away is a broken one.
    if (loaded || error || fontGraceExpired) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error, fontGraceExpired]);

  if (!loaded && !error && !fontGraceExpired) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>
          <ThemeProvider value={polarisTheme}>
            <PolarisProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "transparent" },
                  animation: "fade",
                }}
              >
                <Stack.Screen name="(tabs)" />
                {/* Scanning is something you do and come back from, so it
                    arrives over the tabs rather than replacing them. */}
                <Stack.Screen
                  name="scan"
                  options={{ presentation: "modal", animation: "slide_from_bottom" }}
                />
              </Stack>
            </PolarisProvider>
          </ThemeProvider>
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
});
