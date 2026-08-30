import { ALIGN_CENTER, ALIGN_LEFT, available, printer } from "../../modules/imin-printer";
import { PROGRAM_ID } from "../chain/config";
import type { Charge } from "../chain/charge";
import { quote } from "../chain/charge";

export { available as printerAvailable };

/**
 * The paper.
 *
 * A 58mm roll is 384 dots wide and the head's built-in font is 12 dots per
 * character, so a line is exactly 32 characters. Every row below is composed
 * to that width and printed in that font.
 *
 * It is composed here rather than handed to the printer's own column engine
 * because that engine measures column widths in characters at its default
 * size and rescales them against whatever font size it is given: asking for a
 * 12-character column at size 28 yields about two characters, and the receipt
 * prints one letter per line, vertically. Padding a monospace line cannot go
 * wrong that way.
 */
const W = 32;

const money = (baseUnits: number) => (baseUnits / 1_000_000).toFixed(2);

const rule = (ch = "-") => ch.repeat(W);

/** label left, figure right, on one 32-column line. */
function row(left: string, right: string): string {
  const gap = W - left.length - right.length;
  if (gap < 1) {
    // Never let a long label push the figure off the paper — the figure is
    // the part that has to survive.
    const room = Math.max(0, W - right.length - 1);
    return `${left.slice(0, room)} ${right}`;
  }
  return left + " ".repeat(gap) + right;
}

/** Centre a line inside the 32 columns without relying on printer alignment. */
const centre = (t: string) =>
  t.length >= W ? t.slice(0, W) : " ".repeat(Math.floor((W - t.length) / 2)) + t;

/** Long values — addresses, program ids — wrapped to the roll. */
function wrap(t: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += W) out.push(t.slice(i, i + W));
  return out;
}

function schedule(charge: Charge, each: number, at: number) {
  const rows: string[] = [];
  for (let i = 1; i <= charge.installments; i++) {
    const d = new Date(at + i * charge.intervalSeconds * 1000);
    const when = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    rows.push(row(`  ${i}  ${when}`, money(each)));
  }
  return rows;
}

/**
 * Print the customer's copy.
 *
 * The QR on the paper is the same Solana Pay request as the one on screen, so
 * a customer who walked away can still pay from the receipt. That is why this
 * prints a code at all rather than just a total.
 */
export async function printReceipt(opts: {
  charge: Charge;
  merchantName: string;
  merchantAddress: string;
  at?: number;
}): Promise<void> {
  const { charge, merchantName, merchantAddress } = opts;
  const at = opts.at ?? Date.now();
  const stamp = new Date(at);

  /* The head counts paper it has fed. Reading it either side is the only way
     to tell a receipt that reached paper from one merely accepted. */
  const before = await printer.hardware().catch(() => null);

  // One document: without the buffer each call races the head and content is
  // dropped.
  await printer.beginDocument();

  // Headings go through the bitmap path, which is the only one that honours
  // size and weight. Everything that has to align goes through printMono.
  await printer.printText(merchantName, 34, ALIGN_CENTER, true);
  await printer.printMono(centre("POLARIS PAY  ·  devnet"), ALIGN_LEFT);
  await printer.printMono(rule(), ALIGN_LEFT);

  await printer.printMono(row("DATE", stamp.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })), ALIGN_LEFT);
  await printer.printMono(row("TIME", stamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), ALIGN_LEFT);
  await printer.printMono(row("ORDER", charge.orderId.replace(/^order-/, "")), ALIGN_LEFT);
  await printer.printMono(rule(), ALIGN_LEFT);

  await printer.printMono(row("TOTAL", `${money(charge.usdc * 1_000_000)} USDC`), ALIGN_LEFT);

  if (charge.mode === "later") {
    const q = quote(charge.usdc, charge.installments, charge.intervalSeconds);
    await printer.printMono("", ALIGN_LEFT);
    await printer.printText(`SPLIT INTO ${charge.installments}`, 26, ALIGN_LEFT, true);
    await printer.printMono(row("Buyer repays", money(q.total)), ALIGN_LEFT);
    await printer.printMono(row("Interest, 10% APR", money(q.interest)), ALIGN_LEFT);
    await printer.printMono(rule("."), ALIGN_LEFT);
    for (const line of schedule(charge, q.each, at)) {
      await printer.printMono(line, ALIGN_LEFT);
    }
    await printer.printMono(rule("."), ALIGN_LEFT);
    await printer.printMono("Merchant is paid in full", ALIGN_LEFT);
    await printer.printMono("today. Polaris carries the", ALIGN_LEFT);
    await printer.printMono("instalments.", ALIGN_LEFT);
  } else {
    await printer.printMono("", ALIGN_LEFT);
    await printer.printMono("Paid in full, settles now.", ALIGN_LEFT);
  }

  await printer.printMono("", ALIGN_LEFT);
  await printer.printText("SCAN TO PAY", 24, ALIGN_CENTER, true);
  await printer.printQrCode(charge.solanaUrl, 6, ALIGN_CENTER);

  await printer.printMono("", ALIGN_LEFT);
  await printer.printMono(rule(), ALIGN_LEFT);
  await printer.printMono("MERCHANT", ALIGN_LEFT);
  for (const l of wrap(merchantAddress)) await printer.printMono(l, ALIGN_LEFT);
  await printer.printMono("PROGRAM", ALIGN_LEFT);
  for (const l of wrap(PROGRAM_ID.toBase58())) await printer.printMono(l, ALIGN_LEFT);

  await printer.feedAndCut(3);
  await printer.endDocument();

  const after = await printer.hardware().catch(() => null);
  console.log(
    "[receipt] paper", before?.paperDistance, "->", after?.paperDistance,
    "result", after?.lastPrintResult,
  );
}
