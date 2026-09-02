/**
 * Does bytecode built for this evmVersion actually run on X Layer?
 *
 * X Layer is a Polygon-CDK zkEVM and historically has not implemented the
 * Cancun opcodes (MCOPY, TSTORE/TLOAD). A contract that compiles happily can
 * still be rejected at deploy time. eth_call against the init code answers
 * that for free — no gas, no funded key.
 */
const { ethers } = require("ethers");
const fs = require("fs"), path = require("path");
const RPC = process.argv[2] || "https://testrpc.xlayer.tech";
const FROM = "0xb51756B8Ee57Cc622669E3B3EF67FA305821Bf56";
const DUMMY = "0x000000000000000000000000000000000000dEaD";

function artifacts(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) artifacts(p, out);
    else if (f.endsWith(".json") && !f.endsWith(".dbg.json")) {
      const a = JSON.parse(fs.readFileSync(p, "utf8"));
      if (a.bytecode && a.bytecode !== "0x" && a.contractName) out.push(a);
    }
  }
  return out;
}

const fill = (inputs) => inputs.map((i) => {
  if (i.type === "address") return DUMMY;
  if (i.type.startsWith("uint") || i.type.startsWith("int")) return 1n;
  if (i.type === "bool") return false;
  if (i.type === "string") return "x";
  if (i.type.startsWith("bytes")) return i.type === "bytes" ? "0x" : "0x" + "00".repeat(32);
  throw new Error("unhandled " + i.type);
});

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const net = await p.getNetwork();
  console.log(`chain ${net.chainId} @ ${RPC}\n`);
  let ok = 0, bad = 0, skip = 0;
  for (const a of artifacts("artifacts/contracts")) {
    const ctor = a.abi.find((x) => x.type === "constructor");
    let data;
    try {
      const iface = new ethers.Interface(a.abi);
      data = a.bytecode + iface.encodeDeploy(ctor ? fill(ctor.inputs) : []).slice(2);
    } catch { console.log(`  SKIP  ${a.contractName} (constructor args)`); skip++; continue; }
    try {
      const r = await p.call({ data, from: FROM });
      console.log(`  OK    ${a.contractName.padEnd(24)} ${(r.length - 2) / 2} bytes`);
      ok++;
    } catch (e) {
      const m = (e.shortMessage || e.message || "").slice(0, 120);
      // A constructor that reverts on dummy args is a fine result: the EVM ran it.
      const ranFine = /revert|execution reverted/i.test(m);
      console.log(`  ${ranFine ? "OK*  " : "FAIL "} ${a.contractName.padEnd(24)} ${m}`);
      ranFine ? ok++ : bad++;
    }
  }
  console.log(`\n${ok} ran, ${bad} rejected, ${skip} skipped`);
  console.log(bad === 0 ? "This evmVersion is accepted by the chain." : "OPCODE PROBLEM — lower evmVersion.");
})();
