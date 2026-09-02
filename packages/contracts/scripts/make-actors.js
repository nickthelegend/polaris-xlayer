/**
 * Give the demo real, separate people.
 *
 * With one key the shopper, the merchant and the liquidator are the same
 * address, and every balance assertion double-counts: a liquidation reads as
 * "seized 10 and returned 10 of 10 locked". The contracts were right; the
 * harness could not tell the actors apart. So derive three accounts, fund
 * them with gas from the deployer, and let the demo be three people.
 *
 * Deterministic from the deployer key, so re-running finds the same actors
 * instead of stranding gas in fresh ones.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ROLES = ["shopper", "merchant", "liquidator"];
const GAS_EACH = ethers.parseEther(process.env.ACTOR_GAS || "0.02");

async function main() {
  const [deployer] = await ethers.getSigners();
  const root = process.env.DEPLOYER_PRIVATE_KEY;
  const actors = ROLES.map((role) => {
    // A private key is just 32 bytes; hashing the deployer's with the role
    // name gives a stable, reproducible one per role.
    const pk = ethers.keccak256(ethers.toUtf8Bytes(root + ":stockline:" + role));
    return { role, ...new ethers.Wallet(pk), privateKey: pk, address: new ethers.Wallet(pk).address };
  });

  console.log(`deployer ${deployer.address}  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} OKB\n`);
  for (const a of actors) {
    const bal = await ethers.provider.getBalance(a.address);
    if (bal >= GAS_EACH / 2n) {
      console.log(`${a.role.padEnd(11)} ${a.address}  ${ethers.formatEther(bal)} OKB (already funded)`);
      continue;
    }
    const tx = await deployer.sendTransaction({ to: a.address, value: GAS_EACH });
    await tx.wait();
    console.log(`${a.role.padEnd(11)} ${a.address}  funded ${ethers.formatEther(GAS_EACH)} OKB  ${tx.hash}`);
  }

  const file = path.join(__dirname, "..", "deployments", `actors-${network.name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ network: network.name, actors: actors.map((a) => ({ role: a.role, address: a.address })) }, null, 2)
  );

  // Keys go to .env, never to the deployment record.
  const envPath = path.join(__dirname, "..", "..", "..", ".env");
  let env = fs.readFileSync(envPath, "utf8");
  for (const a of actors) {
    const key = `ACTOR_${a.role.toUpperCase()}_KEY`;
    if (!env.includes(key + "=")) env += `${key}=${a.privateKey}\n`;
  }
  fs.writeFileSync(envPath, env);
  console.log(`\nwrote ${file} and added keys to .env`);
}

main().catch((e) => { console.error(e); process.exit(1); });
