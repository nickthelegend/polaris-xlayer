import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect } from "react";

import { extractRequest, stashRequest } from "./incomingRequest";

/**
 * Opens the scan screen when a Solana Pay code arrives from outside the app.
 *
 * Mounted once, at the root, because a link can land before any screen exists:
 * `getInitialURL` covers a cold start from a code, the listener covers one that
 * arrives while the app is already up.
 *
 * The url is stashed rather than passed as a route parameter — see
 * `incomingRequest.ts` for why putting it in the query string loses half of it.
 */
export function useIncomingRequest(): void {
  useEffect(() => {
    let alive = true;

    function open(link: string | null) {
      if (!alive || !link) return;
      const request = extractRequest(link);
      if (!request) return;
      stashRequest(request);

      /*
       * Only navigate for a scheme the router cannot route itself.
       *
       * A `polaris://scan?request=...` link is already a route, and the router
       * opens it on its own — pushing as well mounts the screen twice, and the
       * second mount is the one left on screen, having found the slot emptied
       * by the first. `solana:` is not a route, so nothing opens without this.
       */
      /*
       * `dismissTo` rather than `push`, so a second code does not stack a
       * second scan screen on top of the first. Each stacked copy subscribed
       * to the slot below, and a copy the user could not see would take the
       * code and act on it off screen.
       */
      if (/^solana:/i.test(link.trim())) router.dismissTo("/scan");
    }

    Linking.getInitialURL().then(open).catch(() => {
      /* no launch url is the normal case, not a failure */
    });
    const sub = Linking.addEventListener("url", (e) => open(e.url));

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
}
