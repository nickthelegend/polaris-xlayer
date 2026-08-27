export type Delegation = {
  /** True when the standing authorisation names the protocol and no one else. */
  toProtocol: boolean;
  /** What that authorisation still covers, in base units. */
  remaining: number;
  /** What is actually owed, in base units. */
  owed: number;
  /** How far the authorisation falls short of the debt. Zero when it covers it. */
  shortfall: number;
};

/**
 * Read the standing authorisation off a raw SPL token account.
 *
 * Split out from the fetch so the decision can be tested against real account
 * bytes rather than only observed on a device — the states that matter most
 * here are the ones a borrower has to go out of their way to create, by
 * revoking the delegate from another wallet.
 *
 * The SPL layout is fixed:
 *
 *   mint(32) owner(32) amount(8) delegateOption(4) delegate(32) state(1)
 *   isNativeOption(4) isNative(8) delegatedAmount(8) closeAuthority(4+32)
 *
 * 165 bytes in total, and the whole account is required: `delegatedAmount`
 * sits at 121, so a short read would turn a length check that passed into a
 * number that means nothing.
 *
 * A missing or truncated account reads as no authorisation at all rather than
 * as a healthy one. Being wrong in that direction shows a warning that is not
 * warranted; being wrong in the other silently promises a collection that will
 * fail.
 */
export function readDelegation(
  data: Uint8Array | null,
  owed: number,
  protocol: Uint8Array,
): Delegation {
  const none = { toProtocol: false, remaining: 0, owed, shortfall: Math.max(0, owed) };
  if (!data || data.length < 165) return none;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const delegateSet = view.getUint32(72, true) === 1;
  if (!delegateSet) return none;

  const delegate = data.subarray(76, 108);
  let toProtocol = protocol.length === 32;
  for (let i = 0; toProtocol && i < 32; i += 1) {
    if (delegate[i] !== protocol[i]) toProtocol = false;
  }

  /*
   * An allowance to somebody else is not an allowance to us. It is reported as
   * revoked rather than as short, because "top it up" is the wrong advice when
   * the authorisation points at another program entirely.
   */
  const remaining = toProtocol ? Number(view.getBigUint64(121, true)) : 0;
  return { toProtocol, remaining, owed, shortfall: Math.max(0, owed - remaining) };
}
