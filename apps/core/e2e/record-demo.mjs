/**
 * Record the demo, by driving the real product.
 *
 * `docs/DEMO.md` had the script and the flow was proven on chain, but nothing
 * had been captured, so the submission had no video. This drives the deployed
 * app with a wallet that really signs and records what happens — every frame is
 * the live site on X Layer testnet, and the transactions in it are real.
 *
 *   E2E_PRIVATE_KEY=0x… node e2e/record-demo.mjs
 *
 * Writes a .webm into e2e/recordings/. Playwright's video is fixed-size and
 * frame-accurate, which is what makes this reproducible: re-running it after a
 * UI change produces a current recording instead of a stale one.
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"
import { createPublicClient, createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "recordings")

const BASE = process.env.E2E_BASE ?? "https://polaris-xlayer.vercel.app"
const KEY = process.env.E2E_PRIVATE_KEY
const RPC = process.env.E2E_RPC ?? "https://testrpc.xlayer.tech"
const CHAIN_ID = 1952

if (!KEY) {
  console.error("E2E_PRIVATE_KEY is required — a funded X Layer testnet wallet with tXAAPL.")
  process.exit(1)
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}

/** Long enough for a viewer to read what changed, short enough to stay watchable. */
const beat = (ms = 1600) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

  const account = privateKeyToAccount(KEY)
  const transport = http(RPC)
  const wallet = createWalletClient({ account, chain, transport })
  const publicClient = createPublicClient({ chain, transport })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()

  // The same signer the e2e suite uses: real key, real broadcasts.
  // Kept out here rather than on `window`, because the init script re-runs on
  // every navigation and resets anything the page was holding.
  const signed = []

  await page.exposeFunction("__polarisRpc", async (method, params) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address]
    if (method === "eth_sendTransaction") {
      const t = params[0]
      const hash = await wallet.sendTransaction({
        to: t.to,
        data: t.data ?? "0x",
        value: t.value ? BigInt(t.value) : 0n,
      })
      signed.push(hash)
      return hash
    }
    return publicClient.request({ method, params })
  })

  await page.addInitScript(
    ({ chainId, address }) => {
      const hex = "0x" + chainId.toString(16)
      const listeners = {}
      window.__polarisSent = []
      window.ethereum = {
        isMetaMask: true,
        chainId: hex,
        selectedAddress: address,
        on(e, f) { (listeners[e] ||= []).push(f) },
        removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f) },
        async request({ method, params = [] }) {
          if (method === "eth_chainId") return hex
          if (method === "net_version") return String(chainId)
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null
          if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }]
          const result = await window.__polarisRpc(method, params)
          if (method === "eth_sendTransaction") window.__polarisSent.push(result)
          return result
        },
      }
      window.dispatchEvent(new Event("ethereum#initialized"))
    },
    { chainId: CHAIN_ID, address: account.address },
  )

  console.log("recording…");

  // 1. The problem, stated before anything is asked of the viewer.
  await page.goto(BASE, { waitUntil: "networkidle" })
  await beat(3000)
  await page.mouse.wheel(0, 700)
  await beat(2600)
  await page.mouse.wheel(0, 700)
  await beat(2600)
  await page.mouse.wheel(0, -1400)
  await beat(1200)

  // 2. Connect. The capacity fills in from the chain.
  await page.getByRole("button", { name: "CONNECT_WALLET" }).first().click()
  await page.getByTestId("shares-input").waitFor({ timeout: 60_000 })
  await beat(2600)

  // 3. Quote — the numbers reconcile on screen.
  await page.getByTestId("shares-input").fill("1")
  await beat(700)
  await page.getByTestId("ref-input").fill(`demo-${Date.now().toString(36)}`)
  await beat(700)
  await page.getByTestId("quote-btn").click()
  await page.getByTestId("quote").waitFor({ timeout: 60_000 })
  await beat(3200)

  // 4. Pay. Shares lock, the merchant is paid from the pool.
  await page.getByTestId("pay-btn").click()
  await page.getByTestId("checkout-done").waitFor({ timeout: 180_000 })
  await beat(3200)

  // 5. The position, and settling it — the shares come back.
  await page.goto(`${BASE}/activity`, { waitUntil: "networkidle" })
  // wagmi remembers the connector across navigations in one context, so the
  // gate is usually already gone by the time this page settles.
  const gate = page.getByRole("button", { name: "CONNECT_WALLET" }).first()
  if (await gate.isVisible().catch(() => false)) await gate.click()
  await page.getByTestId("positions-table").waitFor({ timeout: 60_000 })
  await beat(3000)

  /*
   * Settle a position this wallet can actually afford.
   *
   * Taking the first Repay button recorded a hang: the topmost loan owed more
   * stablecoin than the wallet held, so the app correctly refused it and the
   * recording sat waiting for a success panel that was never coming. The app's
   * refusal is right; the script was wrong to assume the first row.
   */
  const owed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="loan-"]')]
      .map((row) => {
        const id = row.getAttribute("data-testid").replace("loan-", "")
        const cells = [...row.querySelectorAll("td")].map((c) => c.innerText.trim())
        const amount = Number((cells[2] ?? "").replace(/[^0-9.]/g, ""))
        return { id, amount, repayable: Boolean(row.querySelector('[data-testid^="repay-"]')) }
      })
      .filter((l) => l.repayable && l.amount > 0)
      .sort((a, b) => a.amount - b.amount),
  )

  if (owed.length > 0) {
    const cheapest = owed[0]
    await page.getByTestId(`repay-${cheapest.id}`).click()

    const done = page.getByTestId("action-done")
    const failed = page.getByTestId("error")
    await Promise.race([
      done.waitFor({ timeout: 180_000 }),
      failed.waitFor({ timeout: 180_000 }),
    ])
    if (await failed.isVisible().catch(() => false)) {
      // Worth seeing on the recording, and worth saying out loud rather than
      // producing a video that quietly ends on a red panel.
      console.warn(`\n  repay did not complete: ${(await failed.innerText()).trim()}`)
    }
    await beat(3200)
  }

  await context.close()
  await browser.close()

  // Playwright names the file by an internal id; give it one that says what it is.
  const newest = readdirSync(OUT)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, t: Date.now() }))
    .pop()
  if (newest) {
    const named = `polaris-demo-${new Date().toISOString().slice(0, 10)}.webm`
    renameSync(join(OUT, newest.f), join(OUT, named))
    console.log(`\n  ${join("e2e", "recordings", named)}`)
  }
  console.log(`  ${signed.length} real transaction(s) signed during the recording:`)
  for (const h of signed) console.log(`    https://www.oklink.com/x-layer-testnet/tx/${h}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
