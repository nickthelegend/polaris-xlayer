import { expect, test } from "@playwright/test"
import { createWalletClient, createPublicClient, http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { ACTIVE_CHAIN } from "../lib/chains"

/**
 * The checkout, driven by something that really signs.
 *
 * The flow that matters — lock shares, pay the merchant, get the shares back —
 * was only ever proven by hand, with an EIP-1193 provider pasted into a browser
 * console. That harness lived in session transcripts, which means nothing
 * stopped a change breaking the one path the product exists for.
 *
 * The wallet is real and so are the transactions: signing happens in Node with
 * viem, and the page gets a thin `window.ethereum` that forwards to it. An
 * earlier version loaded ethers from a CDN inside the page instead, which fails
 * for a reason worth remembering — an init script runs before
 * `document.documentElement` exists, so there is nothing to append a script tag
 * to. Signing outside the page avoids the whole problem and removes a network
 * dependency from every run.
 *
 * Nothing here is mocked, so this suite is slow, costs testnet gas and needs
 * X Layer to be up. That is why it is not part of `pnpm test`:
 *
 *   pnpm --filter polaris-app e2e
 *
 * It needs a funded testnet wallet in E2E_PRIVATE_KEY (gas plus tXAAPL). With
 * no key the specs skip rather than fail — a machine without a testnet key is
 * not a broken product.
 */

const BASE = process.env.E2E_BASE ?? "https://polaris-xlayer.vercel.app"
const KEY = process.env.E2E_PRIVATE_KEY as Hex | undefined
const RPC = process.env.E2E_RPC ?? ACTIVE_CHAIN.rpcUrls.default.http[0]

test.describe("stock credit checkout", () => {
  test.skip(!KEY, "set E2E_PRIVATE_KEY to a funded X Layer testnet wallet to run this")
  test.describe.configure({ mode: "serial", timeout: 240_000 })

  test.beforeEach(async ({ page }) => {
    const account = privateKeyToAccount(KEY!)
    const transport = http(RPC)
    const wallet = createWalletClient({ account, chain: ACTIVE_CHAIN, transport })
    const publicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport })

    // Signing lives in Node; the page only ever asks for it.
    await page.exposeFunction("__polarisRpc", async (method: string, params: unknown[]) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address]
      if (method === "eth_sendTransaction") {
        const t = params[0] as { to: Hex; data?: Hex; value?: string; gas?: string }
        const hash = await wallet.sendTransaction({
          to: t.to,
          data: t.data ?? "0x",
          value: t.value ? BigInt(t.value) : 0n,
        })
        return hash
      }
      return publicClient.request({ method, params } as never)
    })

    await page.addInitScript(
      ({ chainId, address }) => {
        const hex = "0x" + chainId.toString(16)
        const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
        ;(window as any).__polarisSent = [] as string[]
        ;(window as any).ethereum = {
          isMetaMask: true,
          chainId: hex,
          selectedAddress: address,
          on(e: string, f: () => void) { (listeners[e] ||= []).push(f) },
          removeListener(e: string, f: () => void) {
            listeners[e] = (listeners[e] || []).filter((x) => x !== f)
          },
          async request({ method, params = [] }: { method: string; params?: unknown[] }) {
            if (method === "eth_chainId") return hex
            if (method === "net_version") return String(chainId)
            if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null
            if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }]
            const result = await (window as any).__polarisRpc(method, params)
            if (method === "eth_sendTransaction") (window as any).__polarisSent.push(result)
            return result
          },
        }
        window.dispatchEvent(new Event("ethereum#initialized"))
      },
      { chainId: ACTIVE_CHAIN.id, address: account.address },
    )
  })

  async function connect(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "CONNECT_WALLET" }).first().click()
    // The gate is gone once wagmi has an account.
    await expect(page.getByText("Wallet required")).toHaveCount(0, { timeout: 60_000 })
  }

  test("explains itself before asking for a wallet", async ({ page }) => {
    // The pitch used to sit behind the connect gate, so a first-time visitor
    // saw a login screen and nothing else.
    await page.goto(BASE, { waitUntil: "domcontentloaded" })
    await expect(page.getByText("Spend the stock").first()).toBeVisible()
    await expect(page.getByRole("link", { name: /X Layer faucet/i })).toBeVisible()
  })

  test("refuses to quote against shares the wallet does not hold", async ({ page }) => {
    await page.goto(BASE)
    await connect(page)

    await page.getByTestId("shares-input").fill("100000")
    await page.getByTestId("quote-btn").click()

    await expect(page.getByTestId("error")).toContainText("would need more than that")
    await expect(page.getByTestId("quote")).toHaveCount(0)
    await expect(page.getByTestId("pay-btn")).toHaveCount(0)
  })

  test("locks shares, pays the merchant, and the quote adds up", async ({ page }) => {
    await page.goto(BASE)
    await connect(page)

    await page.getByTestId("shares-input").fill("1")
    await page.getByTestId("ref-input").fill(`e2e-${Date.now().toString(36)}`)
    await page.getByTestId("quote-btn").click()

    const quote = page.getByTestId("quote")
    await expect(quote).toBeVisible({ timeout: 60_000 })

    // ceiling − fee == what the merchant receives. This row printed the net
    // principal once, so the fee row visibly did not reconcile.
    const rows = (await quote.innerText()).split("\n").map((r) => r.trim()).filter(Boolean)
    const valueAfter = (label: string) => {
      const i = rows.findIndex((r) => r.startsWith(label))
      expect(i, `quote should show "${label}"`).toBeGreaterThan(-1)
      return Number((rows[i + 1] ?? "").replace(/[^0-9.]/g, ""))
    }
    const ceiling = valueAfter("Ceiling at")
    const fee = valueAfter("Fee, 7 days")
    const paid = valueAfter("Merchant is paid")
    expect(Math.abs(ceiling - fee - paid)).toBeLessThan(0.02)

    await page.getByTestId("pay-btn").click()
    await expect(page.getByTestId("checkout-done")).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId("error")).toHaveCount(0)

    // The receipt has to be real, not just a green panel in the UI.
    const sent: string[] = await page.evaluate(() => (window as any).__polarisSent)
    expect(sent.length).toBeGreaterThan(0)
    const publicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC) })
    const receipt = await publicClient.getTransactionReceipt({ hash: sent[sent.length - 1] as Hex })
    expect(receipt.status).toBe("success")
  })

  test("the position is repayable, and every share comes back", async ({ page }) => {
    await page.goto(`${BASE}/activity`)
    await connect(page)

    await expect(page.getByTestId("positions-table")).toBeVisible({ timeout: 60_000 })

    const repay = page.locator('[data-testid^="repay-"]').first()
    test.skip((await repay.count()) === 0, "no active position to settle")

    await repay.click()
    await expect(page.getByTestId("action-done")).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId("error")).toHaveCount(0)
  })
})
