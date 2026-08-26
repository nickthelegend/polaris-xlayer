/**
 * Drives the PolarisPay MCP server the way an agent would: a real Client over
 * an in-memory transport, so the SDK's own schema validation runs end to end.
 *
 * The read tools hit live Sepolia. Write tools are asserted to refuse politely
 * without a KeeperHub key rather than throwing something an agent cannot act on.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createPolarisMcpServer } from "../dist/index.js";

const CONTRACTS = {
  loanEngine: "0x21E9740DDe241f0653F699DAa206AfCE1FA25405",
  scoreManager: "0x81C333942eaEe7d3d724c6C2ea28100511934f3C",
  collateralVault: "0xDb6781ed843Ba07Af3321bB8C3952db643324b98",
  payments: "0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f",
  stablecoin: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
};
const BORROWER = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> };

let client: Client;
let close: () => Promise<void>;

function body(result: ToolResult): any {
  const text = result.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

before(async () => {
  // No API key: the read surface must work unauthenticated, which is what makes
  // it safe for an agent to consult before committing to anything.
  const server = createPolarisMcpServer({ chainId: 11_155_111, contracts: CONTRACTS });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "agent", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  close = async () => {
    await client.close();
    await server.close();
  };
});

after(async () => {
  await close();
});

describe("tool discovery", () => {
  it("advertises the full payment surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      "polaris_get_credit",
      "polaris_can_afford",
      "polaris_pay_now",
      "polaris_pay_later",
      "polaris_subscribe",
      "polaris_cancel_subscription",
      "polaris_lock_collateral",
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  });

  it("marks the reads read-only and the spends destructive, so an agent can tell them apart", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    assert.equal(byName.get("polaris_get_credit")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("polaris_pay_now")?.annotations?.destructiveHint, true);
    assert.equal(byName.get("polaris_lock_collateral")?.annotations?.destructiveHint, true);
  });

  it("describes every tool well enough to pick one without reading the source", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      assert.ok((t.description ?? "").length > 60, `${t.name} needs a fuller description`);
    }
  });
});

describe("reads against live Sepolia", () => {
  it("returns a real credit line for a borrower with history", async () => {
    const result = body(
      (await client.callTool({
        name: "polaris_get_credit",
        arguments: { address: BORROWER },
      })) as ToolResult
    );

    assert.ok(result.creditScore >= 300 && result.creditScore <= 850, "score must be in band");
    assert.ok(Number.parseFloat(result.totalLimit) > 0, "limit must be positive");
    // This borrower has locked collateral on chain, so the boost must be real.
    assert.ok(
      Number.parseFloat(result.collateralBoost) > 0,
      "collateral boost should reflect on-chain locked collateral"
    );
    assert.equal(
      Number.parseFloat(result.totalLimit).toFixed(2),
      (
        Number.parseFloat(result.scoreDerivedLimit) + Number.parseFloat(result.collateralBoost)
      ).toFixed(2),
      "total limit must equal score-derived limit plus collateral boost"
    );
  });

  it("returns a zeroed profile for an address with no history, rather than failing", async () => {
    const result = body(
      (await client.callTool({
        name: "polaris_get_credit",
        arguments: { address: "0x000000000000000000000000000000000000dEaD" },
      })) as ToolResult
    );
    assert.equal(result.collateralLocked, "0.00");
    assert.ok(result.creditScore >= 300, "a fresh address still gets the starting score");
  });

  it("answers can_afford with a shortfall an agent can act on", async () => {
    const tiny = body(
      (await client.callTool({
        name: "polaris_can_afford",
        arguments: { address: BORROWER, amount: "1.00" },
      })) as ToolResult
    );
    assert.equal(tiny.affordable, true);
    assert.equal(tiny.shortfall, "0.00");

    const huge = body(
      (await client.callTool({
        name: "polaris_can_afford",
        arguments: { address: BORROWER, amount: "9999999.00" },
      })) as ToolResult
    );
    assert.equal(huge.affordable, false);
    assert.ok(Number.parseFloat(huge.shortfall) > 0, "a refusal must quantify the gap");
    assert.ok(
      Number.parseFloat(huge.collateralNeededToCover) > 0,
      "and say what would close it"
    );
  });
});

describe("writes without credentials", () => {
  it("refuses to spend and explains why, instead of throwing", async () => {
    const result = (await client.callTool({
      name: "polaris_pay_now",
      arguments: { merchant: BORROWER, amount: "1.00", order_id: "test-1" },
    })) as ToolResult;

    assert.equal(result.isError, true);
    assert.match(result.content?.[0]?.text ?? "", /KeeperHub API key/i);
  });

  it("rejects a malformed argument at the schema, before any network call", async () => {
    const result = (await client.callTool({
      name: "polaris_can_afford",
      arguments: { address: BORROWER }, // amount missing
    })) as ToolResult;
    assert.equal(result.isError, true);
  });
});
