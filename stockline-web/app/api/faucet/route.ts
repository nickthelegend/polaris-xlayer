import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ERC20_ABI, EXPLORER, settle, signer , explain } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Give the demo shopper shares to hold. Testnet stand-in token only. */
export async function POST(req: Request) {
  try {
    const { shares } = await req.json();
    const n = Number(shares);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      return NextResponse.json({ error: "Ask for between 0 and 100 shares." }, { status: 400 });
    }
    const shopper = signer("shopper").address;
    const stock = new ethers.Contract(ADDRESSES.stock, ERC20_ABI, signer("deployer"));
    const tx = await stock.mint(shopper, ethers.parseUnits(String(shares), 18));
    const receipt = await tx.wait();
    await settle(receipt);
    return NextResponse.json({ hash: tx.hash, explorer: `${EXPLORER}/tx/${tx.hash}` });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return NextResponse.json({ error: message }, { status });
  }
}
