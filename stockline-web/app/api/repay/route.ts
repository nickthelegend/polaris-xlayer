import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ENGINE_ABI, ERC20_ABI, EXPLORER, settle, signer , explain } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Repay, or refund, or liquidate — every exit the product has. */
export async function POST(req: Request) {
  try {
    const { loanId, action } = await req.json();
    const id = Number(loanId);
    if (!Number.isInteger(id) || id < 0) {
      return NextResponse.json({ error: "A loan id is required." }, { status: 400 });
    }
    const role = action === "refund" ? "merchant" : action === "liquidate" ? "liquidator" : "shopper";
    const who = signer(role as any);
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, who);
    const stable = new ethers.Contract(ADDRESSES.stable, ERC20_ABI, who);

    const owed: bigint = await engine.amountOwed(id);
    if (owed === 0n) {
      return NextResponse.json({ error: "That loan is already closed." }, { status: 409 });
    }

    // The payer needs the stablecoin. On testnet the stand-in mints, which is
    // the deployer's job, not this account's.
    const bal: bigint = await stable.balanceOf(who.address);
    if (bal < owed) {
      const minter = new ethers.Contract(ADDRESSES.stable, ERC20_ABI, signer("deployer"));
      await settle(await (await minter.mint(who.address, owed - bal)).wait());
    }
    const allowance: bigint = await stable.allowance(who.address, ADDRESSES.engine);
    if (allowance < owed) {
      await settle(await (await stable.approve(ADDRESSES.engine, ethers.MaxUint256)).wait());
    }

    const tx =
      action === "refund" ? await engine.refund(id)
      : action === "liquidate" ? await engine.liquidate(id)
      : await engine.repay(id);
    const receipt = await tx.wait();
    await settle(receipt);

    return NextResponse.json({
      hash: tx.hash, block: receipt!.blockNumber, action: action || "repay",
      explorer: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return NextResponse.json({ error: message }, { status });
  }
}
