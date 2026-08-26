import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { connection, program } from "../src/chain/client";
import { pdas } from "../src/chain/pdas";
import idl from "../src/chain/idl.json";

async function main() {
  const sigs = await connection.getSignaturesForAddress(pdas.protocol, { limit: 5 });
  console.log("sigs:", sigs.length, "| errs:", sigs.filter((s) => s.err).length);

  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  );
  console.log("getTransactions returned:", txs.length, "| nulls:", txs.filter((t) => !t).length);

  const parser = new EventParser(program.programId, new BorshCoder(idl as any));
  const first = txs.find((t) => t?.meta?.logMessages);
  if (!first) { console.log("no tx with logs"); return; }

  const events = [...parser.parseLogs(first.meta!.logMessages!)];
  console.log("events parsed from first tx:", events.length);
  for (const e of events) console.log("  name:", JSON.stringify(e.name));

  console.log("\nblockTime present:", sigs.map((s) => s.blockTime).filter(Boolean).length, "/", sigs.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
