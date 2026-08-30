// Side-effect import, first: web3.js needs Buffer and getRandomValues installed
// before anything constructs a PublicKey.
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

import { ink, palette } from "../src/theme";

/** See the borrower app's layout: the navigator's default theme is light and
 *  would lay a grey plate over the ambient ground on every screen. */
const merchantTheme: Theme = {
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

SplashScreen.preventAutoHideAsync().catch(() => {});

/** The font gate expires rather than blocking forever — `useFonts` has a third
 *  outcome, neither loaded nor errored, and returning null on it is a black
 *  screen with no crash. The borrower app shipped exactly that bug. */
const FONT_GRACE_MS = 2500;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const [graceExpired, setGraceExpired] = useState(false);

  useEffect(() => {
    if (loaded || error) return;
    const t = setTimeout(() => setGraceExpired(true), FONT_GRACE_MS);
    return () => clearTimeout(t);
  }, [loaded, error]);

  useEffect(() => {
    if (loaded || error || graceExpired) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error, graceExpired]);

  if (!loaded && !error && !graceExpired) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>
          <ThemeProvider value={merchantTheme}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" }, animation: "fade" }}>
              <Stack.Screen name="(tabs)" />
            </Stack>
          </ThemeProvider>
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
});
