import {
  JetBrainsMono_400Regular, JetBrainsMono_500Medium
} from "@expo-google-fonts/jetbrains-mono";
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, useFonts
} from "@expo-google-fonts/space-grotesk";
import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AmbientBackground } from "../src/components";
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

  useEffect(() => {
    // Hide on error as well as success. A font that failed to load is a worse
    // app, but a splash screen that never goes away is a broken one.
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>
          {/*
            The ground is mounted once here, above the navigator, so it does not
            re-render or re-animate when a route changes. It is the floor: it
            must not move when you walk across it.
          */}
          <AmbientBackground />

          <ThemeProvider value={polarisTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "transparent" },
                animation: "fade",
              }}
            >
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
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
});
