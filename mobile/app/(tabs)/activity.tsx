import * as Haptics from "expo-haptics";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { enterUp } from "../../src/components/motion";
import Svg, { Path } from "react-native-svg";

import {
  Empty, ErrorState, Figure, Loading, Mono, Rule, Screen, Surface, Text
} from "../../src/components";
import { usePolaris } from "../../src/chain/provider";
import { explorerTx } from "../../src/chain/config";
import type { ActivityEvent } from "../../src/chain/queries";
import { palette, radius, space } from "../../src/theme";

const glyphs: Record<ActivityEvent["kind"], { path: string; tint: string }> = {
  // Arrow into a tray.
  collected: { path: "M12 4v10m0 0 4-4m-4 4-4-4M4 18h16", tint: palette.primary },
  // Arrow out of a tray.
  originated: { path: "M12 20V10m0 0 4 4m-4-4-4 4M4 4h16", tint: palette.accent },
  // A repeating cycle.
  charged: { path: "M4 12a8 8 0 0 1 14-5m2 5a8 8 0 0 1-14 5M18 4v3h-3M6 20v-3h3", tint: palette.accent },
  settled: { path: "M4 12h16M12 4v16", tint: palette.primary },
  liquidated: { path: "M12 4v9m0 4h.01M4 20h16L12 4Z", tint: palette.destructive },
  // An upward step.
  score: { path: "M4 18h4v-4h4V9h4V5h4", tint: palette.primary },
};

const ago = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 3_600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d}d ago`;
};

function Row({ event, index }: { event: ActivityEvent; index: number }) {
  const g = glyphs[event.kind];
  const explorer = explorerTx(event.signature);

  return (
    <Animated.View
      entering={enterUp(index)}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          Linking.openURL(explorer).catch(() => {});
        }}
        style={styles.row}
      >
        <View style={[styles.glyph, { borderColor: `${g.tint}33` }]}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d={g.path}
              stroke={g.tint}
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>

        <View style={styles.body}>
          <View style={styles.head}>
            <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
              {event.title}
            </Text>
            {event.amount !== undefined ? (
              <Figure
                value={event.amount}
                variant="body"
                animate={false}
                tone={event.kind === "originated" ? "accent" : "default"}
              />
            ) : null}
          </View>

          <Text variant="bodySmall" tone="faint" numberOfLines={1}>
            {event.detail} · {ago(event.at)}
          </Text>

          {/*
            The signature is the receipt. There is no separate record to
            reconcile against and nothing to dispute it with — so it is shown
            rather than hidden behind a details screen, and it opens the
            explorer.
          */}
          <Mono numberOfLines={1} style={styles.sig}>
            {event.signature.slice(0, 22)}…
          </Mono>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function ActivityScreen() {
  const { status, data, error, refresh } = usePolaris();

  if (status === "loading") {
    return (
      <Screen eyebrow="Every movement of money" title="Activity">
        <Loading label="Reading the ledger" />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen eyebrow="Every movement of money" title="Activity">
        <ErrorState message={error ?? "No data returned."} onRetry={refresh} />
      </Screen>
    );
  }

  const { activity } = data;

  return (
    <Screen
      eyebrow="Every movement of money"
      title="Activity"
      lede="Each row is a transaction that landed. Tap one to open it on the explorer."
    >
      {activity.length ? (
        <Surface padded={0}>
          {activity.map((event, i) => (
            <View key={event.id}>
              {i > 0 ? <Rule /> : null}
              <Row event={event} index={i} />
            </View>
          ))}
        </Surface>
      ) : (
        <Empty
          title="Nothing has moved yet"
          note="Collections, subscription charges and score changes all land here."
        />
      )}

      <Text variant="bodySmall" tone="faint" style={styles.foot}>
        Collections are paid for by the keeper, so none of these cost you a
        network fee.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
  },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
    borderWidth: 1,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  sig: {
    marginTop: 3,
    opacity: 0.55,
    fontSize: 11,
  },
  foot: {
    textAlign: "center",
    marginTop: space.xl,
    paddingHorizontal: space["2xl"],
  },
});
