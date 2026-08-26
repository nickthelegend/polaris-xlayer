import {
  fetchActivity,
  fetchLoans,
  fetchProfile,
  fetchProtocol,
  fetchSubscriptions,
} from "../src/chain/queries";

const usd = (r: number) => (r / 1e6).toFixed(6);

async function main() {
  const proto = await fetchProtocol();
  console.log("PROTOCOL", JSON.stringify(proto));

  const profile = await fetchProfile();
  console.log("PROFILE ", JSON.stringify(profile));

  const loans = await fetchLoans();
  console.log(`LOANS   ${loans.length}`);
  for (const l of loans) {
    console.log(
      `  #${l.id} ${l.merchant.padEnd(20)} ${l.status.padEnd(11)} ` +
        `${l.installmentsPaid}/${l.installmentCount}  owed ${usd(l.totalOwed)}  repaid ${usd(l.totalRepaid)}  iv ${l.intervalSeconds}s`,
    );
  }

  const subs = await fetchSubscriptions();
  console.log(`SUBS    ${subs.length}`);
  for (const s of subs) {
    console.log(
      `  ${s.merchant.padEnd(16)} ${s.name.padEnd(14)} ${usd(s.pricePerPeriod)} / ${s.periodSeconds}s  period ${s.periodsCharged}  ${s.status}`,
    );
  }

  const acts = await fetchActivity(30);
  console.log(`ACTIVITY ${acts.length}`);
  for (const a of acts.slice(0, 10)) {
    console.log(
      `  ${a.kind.padEnd(11)} ${a.title.padEnd(38)} ${a.amount !== undefined ? usd(a.amount) : ""}  ${a.signature.slice(0, 12)}`,
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
