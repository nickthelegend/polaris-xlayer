import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { extractRequest, peekRequest, stashRequest } from "../src/chain/incomingRequest";
import { Button, Surface, Text } from "../src/components";
import { Screen } from "../src/components/Screen";
import { space } from "../src/theme";

/**
 * Where a link goes when it matches nothing — and the last chance to rescue one.
 *
 * A Solana Pay code handed over by another app arrives as `solana:<url>`, and
 * the router rewrites it into this app's own scheme before matching, which
 * matches no route at all. Landing a borrower on a "page not found" while
 * holding a payment they were about to make is the worst version of this, so
 * the payload is recovered here and the payment continues.
 *
 * Anything genuinely unroutable gets a real screen rather than the framework's
 * developer page, which shows a raw url and a link to a sitemap.
 */
export default function NotFound() {
  const pathname = usePathname();
  const [rescuing, setRescuing] = useState(true);

  useEffect(() => {
    /*
     * The stash first, and the path only as a fallback.
     *
     * The root listener sees the link as the platform delivered it, before the
     * router rewrites the scheme, so what it stashed is the intact request.
     * By the time the router has decided nothing matches, `pathname` is
     * whatever survived that rewrite -- worth trying, but not worth trusting.
     */
    const request = peekRequest() ?? extractRequest(pathname);
    if (request) {
      stashRequest(request);
      router.replace("/scan");
      return;
    }
    setRescuing(false);
  }, [pathname]);

  // Nothing is drawn while a payment is being recovered: showing "not found"
  // for the frame before the redirect reads as the payment having failed.
  if (rescuing) return <View style={styles.blank} />;

  return (
    <Screen eyebrow="Polaris" title="That link goes nowhere">
      <Surface padded={20}>
        <Text variant="body" tone="soft">
          Whatever opened this pointed at a screen that does not exist. Nothing
          was charged, and your credit line is untouched.
        </Text>
        <View style={styles.actions}>
          <Button label="Back to my credit line" full onPress={() => router.replace("/")} />
        </View>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1 },
  actions: { marginTop: space.lg },
});
