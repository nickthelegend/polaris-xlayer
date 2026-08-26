import { createHash } from "node:crypto";

/**
 * A merchant order id as the program sees it: exactly 32 bytes.
 *
 * Short ids go in directly, right-aligned and zero-padded, so the payment
 * address is derivable from the order id by anyone holding it. Anything longer
 * is hashed -- never truncated, which would make two long ids sharing a prefix
 * the same order, and get the second payment refused as a duplicate.
 *
 * Deliberately identical to the SDK's `orderRef`. `test/order.test.ts` asserts
 * the two agree, because a gateway that derives a different payment address
 * from the same order id would refuse valid payments as duplicates.
 */
export function orderRef(orderId: string): Buffer {
  const bytes = Buffer.from(orderId, "utf8");
  if (bytes.length <= 32) {
    const out = Buffer.alloc(32);
    bytes.copy(out, 32 - bytes.length);
    return out;
  }
  return createHash("sha256").update(bytes).digest();
}
