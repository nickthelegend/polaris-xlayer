import { connection, program } from "../src/chain/client";
import { pdas } from "../src/chain/pdas";

async function main() {
  console.log("protocol PDA:", pdas.protocol.toBase58());
  console.log("program:", program.programId.toBase58());

  const byProtocol = await connection.getSignaturesForAddress(pdas.protocol, { limit: 10 });
  console.log("signatures for protocol PDA:", byProtocol.length);

  const byProgram = await connection.getSignaturesForAddress(program.programId, { limit: 10 });
  console.log("signatures for program id:", byProgram.length);

  if (byProgram.length) {
    const tx = await connection.getTransaction(byProgram[0].signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    console.log("first tx logs:", tx?.meta?.logMessages?.length ?? 0);
    console.log((tx?.meta?.logMessages ?? []).slice(0, 8).join("\n"));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
