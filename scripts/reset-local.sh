#!/usr/bin/env bash
# Stand up a clean local cluster with the program deployed and real state seeded.
#
# --limit-ledger-size is the important flag here, and the default is a trap.
#
# solana-test-validator keeps 10,000 shreds of root slots by default and
# produces slots continuously whether or not anything is happening. On a
# validator left running for half an hour, the slots holding the seed
# transactions are purged out from under you — and getSignaturesForAddress
# then returns almost nothing, so an activity feed silently empties. That looks
# exactly like a bug in the app, and it is not one.
#
# Transaction history itself is on by default in the test validator; the
# --enable-rpc-transaction-history flag belongs to agave-validator and is
# rejected here.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8899
PID=$(cat .program-id.txt)
LOG=${1:-/tmp/polaris-validator.log}

pkill -f solana-test-validator 2>/dev/null || true
sleep 2
rm -rf test-ledger

nohup solana-test-validator \
  --bpf-program "$PID" target/deploy/polaris.so \
  --limit-ledger-size 100000000 \
  --reset --quiet --ledger test-ledger > "$LOG" 2>&1 &

for i in $(seq 1 60); do
  solana cluster-version --url "$RPC" >/dev/null 2>&1 && break
  sleep 1
done

solana airdrop 500 --url "$RPC" >/dev/null 2>&1 || true
echo "validator up · program $PID"

POLARIS_CLUSTER=localnet pnpm exec tsx scripts/seed.ts
cp deployments/localnet-seed.json mobile/src/chain/deployment.json
# The IDL carries the program id too, and Anchor reads it from there rather
# than from deployment.json. Syncing one without the other left the app calling
# an address that no longer had a program on it.
cp target/idl/polaris.json mobile/src/chain/idl.json
echo "deployment.json synced to the app"
