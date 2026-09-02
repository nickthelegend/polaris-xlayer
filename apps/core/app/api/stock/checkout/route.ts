import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ENGINE_ABI, ERC20_ABI, EXPLORER, settle, signer , explain } from "@/lib/stock-chain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Lock the shares, pay the merchant. One real transaction on X Layer. */
export async function POST(req: Request) {
  try {
    const { shares, borrowAmount, orderRef, tenorDays } = await req.json();
    if (!orderRef || typeof orderRef !== "string" || !orderRef.trim()) {
      return NextResponse.json({ error: "An order reference is required." }, { status: 400 });
    }
    const n = Number(shares);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "Enter a number of shares greater than zero." }, { status: 400 });
    }
    const days = Number(tenorDays ?? 7);
    if (!Number.isInteger(days) || days < 7 || days > 14) {
      return NextResponse.json({ error: "The tenor must be between 7 and 14 days." }, { status: 400 });
    }

    const shopper = signer("shopper");
    const merchant = signer("merchant").address;
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, shopper);
    const stock = new ethers.Contract(ADDRESSES.stock, ERC20_ABI, shopper);

    const wei = ethers.parseUnits(String(shares), 18);
    const held = await stock.balanceOf(shopper.address);
    if (held < wei) {
      return NextResponse.json(
        { error: `You hold ${ethers.formatUnits(held, 18)} shares; this checkout needs ${shares}.` },
        { status: 400 }
      );
    }

    const ref = ethers.id(orderRef.trim());
    const [used] = await engine.loanIdForOrder(merchant, ref, shopper.address);
    if (used) {
      return NextResponse.json(
        { error: `Order "${orderRef.trim()}" has already been paid. Use a new reference.` },
        { status: 409 }
      );
    }

    const allowance = await stock.allowance(shopper.address, ADDRESSES.engine);
    let approveHash: string | null = null;
    if (allowance < wei) {
      const a = await stock.approve(ADDRESSES.engine, ethers.MaxUint256);
      await settle(await a.wait());
      approveHash = a.hash;
    }

    const borrow = BigInt(borrowAmount);
    const tx = await engine.openLoan(ADDRESSES.stock, wei, merchant, ref, borrow, days * 86400);
    const receipt = await tx.wait();
    await settle(receipt);

    const id = Number(await engine.loanCount()) - 1;
    return NextResponse.json({
      loanId: id,
      hash: tx.hash,
      approveHash,
      block: receipt!.blockNumber,
      gasUsed: receipt!.gasUsed.toString(),
      explorer: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return NextResponse.json({ error: message }, { status });
  }
}
