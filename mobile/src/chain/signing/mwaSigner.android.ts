import { transact, type Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import { authStore } from "./authStore";
import {
  assertSignable,
  classifyMwaError,
  decodeBase64Address,
  explainMwaFailure,
  shouldAuthorize,
  type ChainId,
} from "./pure.ts";
import type { ChainSigner } from "./types.ts";

/**
 * The Android build of the signer: transactions are signed by a wallet app the
 * user already has, and this app never sees a private key.
 *
 * **This is the only file in the repository that imports `@solana-mobile`.**
 * Metro resolves `./mwaSigner` here on Android and to `mwaSigner.ts`
 * everywhere else, which keeps a native TurboModule out of the iOS and web
 * bundles entirely. See the sibling file for why a runtime check could not
 * have done that.
 */
export const MWA_AVAILABLE = true;

const IDENTITY = {
  name: "Polaris",
  uri: "https://polaris.fun",
  icon: "favicon.ico",
} as const;

/**
 * One wallet session at a time, across the whole app.
 *
 * The native module holds a mutex, so a second `transact` while one is open
 * fails. A `useRef` guard is not enough here for a reason specific to this
 * flow: authorizing brings the *wallet* app to the foreground, which can
 * unmount the screen that owns the ref — and the modal checkout is exactly
 * such a screen. Module scope survives that; a ref does not.
 */
let inFlight: Promise<unknown> | null = null;

async function session<T>(run: (wallet: Web3MobileWallet) => Promise<T>): Promise<T> {
  while (inFlight) {
    try {
      await inFlight;
    } catch {
      /* the previous caller's failure is theirs to report, not ours */
    }
  }
  /*
   * No try/catch inside the callback. `transact` closes the session in its own
   * `finally`, and swallowing an error in here strands it open.
   */
  const attempt = transact(run);
  inFlight = attempt;
  try {
    return await attempt;
  } finally {
    inFlight = null;
  }
}

type Authorized = { publicKey: PublicKey; address: string; label: string; token: string };

async function authorizeWith(wallet: Web3MobileWallet, chainId: ChainId): Promise<Authorized> {
  const cached = await authStore.load();

  /*
   * `reauthorize` is called by name rather than by passing `auth_token` to
   * `authorize`. They are not interchangeable: against a wallet speaking the
   * legacy protocol, `authorize` falls through into the reauthorize branch and
   * drops every parameter except the token and the identity — the chain
   * included, so the wallet would happily sign for the wrong cluster.
   */
  const route = shouldAuthorize(cached, chainId);
  const result =
    route === "reauthorize" && cached
      ? await wallet.reauthorize({ auth_token: cached.token, identity: IDENTITY })
      : await wallet.authorize({ identity: IDENTITY, chain: chainId });

  const account = result.accounts[0];
  if (!account) throw new Error("The wallet authorized no accounts.");

  // Always re-read the account from the result: a wallet may hand back a
  // different active account than the one that was cached.
  const publicKey = new PublicKey(decodeBase64Address(account.address));
  const label = ("label" in account && account.label) || shorten(publicKey.toBase58());

  await authStore.save({ token: result.auth_token, chainId, address: account.address });
  return { publicKey, address: account.address, label, token: result.auth_token };
}

class MwaSigner implements ChainSigner {
  readonly kind = "mwa" as const;
  readonly label: string;
  readonly publicKey: PublicKey;
  private readonly chainId: ChainId;

  constructor(auth: Authorized, chainId: ChainId) {
    this.publicKey = auth.publicKey;
    this.label = auth.label;
    this.chainId = chainId;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const [signed] = await this.signAllTransactions([tx]);
    return signed as T;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    for (const tx of txs) assertSignable(tx as never);

    try {
      return await session(async (wallet) => {
        await authorizeWith(wallet, this.chainId);
        // `transactions`, taking real web3.js objects — not the protocol
        // package's `payloads`, which are base64 strings.
        return wallet.signTransactions({ transactions: txs });
      });
    } catch (error) {
      const failure = classifyMwaError(error);
      /*
       * A stale authorization is the one failure worth retrying by itself: the
       * token expired, the user has done nothing wrong, and asking them to
       * press the button again to reach the same wallet is noise.
       */
      if (failure.kind === "stale-auth") {
        await authStore.clear();
        return session(async (wallet) => {
          await authorizeWith(wallet, this.chainId);
          return wallet.signTransactions({ transactions: txs });
        });
      }
      throw new Error(explainMwaFailure(failure));
    }
  }

  async disconnect(): Promise<void> {
    const cached = await authStore.load();
    await authStore.clear();
    if (!cached) return;
    try {
      await session((wallet) => wallet.deauthorize({ auth_token: cached.token }));
    } catch {
      // The local token is already gone, which is what actually governs this
      // app. Telling the wallet is a courtesy that may fail if it is uninstalled.
    }
  }
}

/** Connect a wallet app. Must be user-initiated: it needs a foreground activity. */
export async function createMwaSigner(chainId: ChainId): Promise<ChainSigner> {
  try {
    const auth = await session((wallet) => authorizeWith(wallet, chainId));
    return new MwaSigner(auth, chainId);
  } catch (error) {
    throw new Error(explainMwaFailure(classifyMwaError(error)));
  }
}

const shorten = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
