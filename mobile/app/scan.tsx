import { CameraView, useCameraPermissions } from "expo-camera";
import { failed, press, succeeded, tap } from "../src/lib/haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { usePolaris } from "../src/chain/provider";
import {
  approvePayment,
  describeRequest,
  parseSolanaPayUrl,
  preparePayment,
  type PreparedPayment,
} from "../src/chain/solanaPay";
import { describeError } from "../src/chain/actions";
import { extractRequest, onRequestStashed, takeRequest } from "../src/chain/incomingRequest";
import { Button, Label, Surface, Text } from "../src/components";
import { ink, palette, space } from "../src/theme";

type Stage =
  | { name: "scanning" }
  | { name: "reading"; label: string }
  | { name: "review"; label: string; prepared: PreparedPayment }
  | { name: "sending" }
  | { name: "done"; signature: string; summary: string }
  | { name: "failed"; message: string };

/**
 * Scan a Polaris code and pay it.
 *
 * The order matters and is the whole security argument: the code is decoded,
 * the endpoint is asked what it is, a transaction is fetched, and only then is
 * anything shown to approve. Nothing is signed until the borrower has seen the
 * merchant's own description of what they are agreeing to.
 */
export default function ScanScreen() {
  const router = useRouter();

  /*
   * Leaving has to work even when there is nowhere to go back to.
   *
   * This screen is reachable directly by url — that is the documented way a
   * merchant hands a code to the web build — and a tab opened straight onto
   * `/scan?request=...` has a single entry in the navigator. Going back on a
   * single-entry stack does nothing at all, so Close and Done were dead
   * controls: the payment card fell back to the camera prompt and the borrower
   * was stranded on a screen with no way into the app. `canGoBack` is no help
   * either — it answers about browser history, which says yes while the
   * navigator stays exactly where it was.
   */
  const leave = useCallback(() => {
    // Dismiss down to the tabs, replacing this screen if it is the only one.
    router.dismissTo("/");
  }, [router]);
  const insets = useSafeAreaInsets();
  const { refresh } = usePolaris();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ name: "scanning" });
  /*
   * A request handed straight to the screen, without the camera.
   *
   * This is how Solana Pay actually reaches a wallet on a phone most of the
   * time: the checkout page's "Open in a wallet" link is a `solana:` URL, and
   * the OS hands it to whichever app claims the scheme. The camera is for when
   * the code is on someone else's screen.
   */
  const { request } = useLocalSearchParams<{ request?: string }>();
  const handledRef = useRef<string | null>(null);

  /*
   * A barcode in frame fires continuously, several times a second. Without a
   * latch the first scan would start a request and the next twenty would start
   * twenty more — the same class of bug as a double-tapped submit, and with
   * the same consequence.
   */
  const latched = useRef(false);

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (latched.current) return;
      latched.current = true;
      succeeded();

      try {
        const url = parseSolanaPayUrl(data);
        setStage({ name: "reading", label: "" });
        const described = await describeRequest(url);
        setStage({ name: "reading", label: described.label });
        const prepared = await preparePayment(url);
        setStage({ name: "review", label: described.label, prepared });
      } catch (e: any) {
        setStage({ name: "failed", message: await describeError(e) });
      }
    },
    [],
  );

  /*
   * The same lock the checkout screen needs, for the same reason.
   *
   * `stage` is React state, and a second tap 100ms later runs this again
   * before the re-render — reading the stale "review" and sending the
   * transaction twice. Solana would dedupe two identical signatures, but the
   * two in-flight confirmations race to set the final stage, so a success can
   * be overwritten by the loser's error. A ref updates synchronously.
   */
  const approving = useRef(false);

  const approve = useCallback(async () => {
    if (stage.name !== "review" || approving.current) return;
    approving.current = true;
    const { prepared } = stage;
    setStage({ name: "sending" });
    try {
      const signature = await approvePayment(prepared.transaction);
      succeeded();
      await refresh();
      setStage({ name: "done", signature, summary: prepared.message });
    } catch (e: any) {
      setStage({ name: "failed", message: await describeError(e) });
    } finally {
      approving.current = false;
    }
  }, [stage, refresh]);

  useEffect(() => {
    /*
     * Two ways in. A code that arrived from outside the app was stashed by the
     * root listener and is read from memory, because carrying a Solana Pay url
     * through a query string loses everything after its first parameter on
     * Android. The `request` parameter stays for the web build, where the
     * address bar is the only channel there is.
     */
    const handed = takeRequest();
    /*
     * The parameter's own value, not a query string rebuilt around it.
     *
     * Wrapping it back up as `?request=<value>` and re-parsing meant
     * URLSearchParams split the value on its own `&`: the router hands this
     * back already decoded on web, so everything after the first parameter of
     * the merchant's url was dropped and the checkout was re-fetched without
     * its amount, which the gateway rightly answered 400. `extractRequest`
     * takes the bare value in either encoding.
     */
    const incoming = handed ?? (request ? extractRequest(request) : null);
    if (!incoming) return;
    /*
     * Exactly once per code, per screen.
     *
     * `onScanned` is rebuilt whenever the stage changes, so without this the
     * effect re-runs on every step of the payment and starts the same one
     * again — after paying, tapping Done put the finished payment back on
     * screen offering to pay it a second time. The order pda would refuse the
     * duplicate on chain, but the app should not be offering it at all.
     */
    if (handledRef.current === incoming) return;
    handledRef.current = incoming;
    void onScanned({ data: incoming });
  }, [request, onScanned]);

  /*
   * A code that arrives while this screen is already open. The mount effect
   * above only runs on a mount, and there is not always a new one.
   *
   * Scoped to focus so only the screen the borrower is actually looking at
   * takes the code out of the slot.
   */
  useFocusEffect(
    useCallback(
      () =>
        onRequestStashed(() => {
          const handed = takeRequest();
          if (!handed || handledRef.current === handed) return;
          handledRef.current = handed;
        /*
         * Release the latch first. It exists to stop the camera acting on the
         * same code in twenty consecutive frames; a code the system just
           * handed us is unambiguously a new one, and leaving the latch closed
           * meant the second code a merchant sent was silently dropped.
           */
          latched.current = false;
          approving.current = false;
          void onScanned({ data: handed });
        }),
      [onScanned],
    ),
  );

  const scanAgain = useCallback(() => {
    latched.current = false;
    approving.current = false;
    setStage({ name: "scanning" });
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <View style={styles.header}>
        <View>
          <Label>Scan to pay</Label>
          <Text variant="heading" style={styles.title}>
            {/* Keyed on what is happening, not on how the code arrived. A
                code handed over by another app is stashed rather than passed
                as a route parameter, so asking about the parameter told a
                borrower staring at a payment to go point at a code. */}
            {stage.name === "scanning" ? "Point at a Polaris code" : "Confirm this payment"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the scanner"
          onPress={leave}
          style={styles.close}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={ink.soft}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.viewport}>
        {stage.name === "scanning" ? (
          permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onScanned}
            />
          ) : (
            <View style={styles.permission}>
              <Text variant="body" tone="soft" style={styles.centered}>
                {permission
                  ? "Polaris needs the camera to read a merchant's code. Nothing is recorded — the frame is decoded and discarded."
                  : "Checking the camera…"}
              </Text>
              {permission && !permission.granted ? (
                <Button label="Allow the camera" onPress={requestPermission} />
              ) : null}
            </View>
          )
        ) : null}

        {/* The finder. Drawn over whatever the viewport is showing. */}
        <View style={[styles.finder, { pointerEvents: "none" }]}>
          {(["tl", "tr", "bl", "br"] as const).map((corner) => (
            <View key={corner} style={[styles.corner, styles[corner]]} />
          ))}
        </View>

        {stage.name !== "scanning" ? (
          <Animated.View entering={FadeIn.duration(160)} style={styles.cover}>
            <Result
              stage={stage}
              onApprove={approve}
              onScanAgain={scanAgain}
              onDone={leave}
            />
          </Animated.View>
        ) : null}
      </View>

      <Text variant="bodySmall" tone="faint" style={styles.footnote}>
        {Platform.OS === "web"
          ? "Your browser will ask for the camera. A merchant's checkout page shows the code to scan."
          : "A merchant shows the code at checkout. Nothing is charged until you approve it here."}
      </Text>
    </View>
  );
}

function Result({
  stage,
  onApprove,
  onScanAgain,
  onDone,
}: {
  stage: Stage;
  onApprove: () => void;
  onScanAgain: () => void;
  onDone: () => void;
}) {
  if (stage.name === "reading") {
    return (
      <Surface padded={20} style={styles.card}>
        <Label>Reading the code</Label>
        <Text variant="body" style={styles.cardBody}>
          {stage.label ? stage.label : "Asking the merchant what this is…"}
        </Text>
      </Surface>
    );
  }

  if (stage.name === "review") {
    return (
      <Surface padded={20} style={styles.card}>
        <Label>{stage.label}</Label>
        <Text variant="body" style={styles.cardBody}>
          {stage.prepared.message}
        </Text>
        <Text variant="bodySmall" tone="faint" style={styles.cardBody}>
          The merchant pays the network fee. Nothing is charged until you
          approve.
        </Text>
        <Button label="Approve and pay" full onPress={onApprove} />
        <Button label="Cancel" variant="ghost" size="sm" onPress={onScanAgain} />
      </Surface>
    );
  }

  if (stage.name === "sending") {
    return (
      <Surface padded={20} style={styles.card}>
        <Label>Signing</Label>
        <Text variant="body" style={styles.cardBody}>
          Submitting to the cluster…
        </Text>
      </Surface>
    );
  }

  if (stage.name === "done") {
    return (
      <Surface padded={20} style={styles.card}>
        <Label>Confirmed</Label>
        <Text variant="body" style={styles.cardBody}>
          {stage.summary}
        </Text>
        <Text variant="mono" tone="faint" numberOfLines={1} style={styles.cardBody}>
          {stage.signature}
        </Text>
        <Button label="Done" full onPress={onDone} />
      </Surface>
    );
  }

  if (stage.name !== "failed") return null;

  return (
    <Surface padded={20} style={styles.card}>
      <Label>Refused</Label>
      <Text variant="body" tone="danger" style={styles.cardBody}>
        {stage.message}
      </Text>
      <Button label="Scan again" full onPress={onScanAgain} />
    </Surface>
  );
}

const CORNER = 26;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#05080B",
    paddingHorizontal: space.lg,
    gap: space.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: { marginTop: 2 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: ink.hairline,
  },
  viewport: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#0A0F14",
    borderWidth: 1,
    borderColor: ink.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  permission: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  centered: { textAlign: "center" },
  finder: { ...StyleSheet.absoluteFill, margin: space["3xl"] },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: palette.primary,
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(5, 8, 11, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
  },
  card: { width: "100%", maxWidth: 380, gap: space.md },
  cardBody: { marginTop: 2 },
  footnote: { textAlign: "center", marginBottom: space.lg },
});
