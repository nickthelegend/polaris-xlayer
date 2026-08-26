/**
 * React entry point: `import { PayWithPolarisBNPL } from "polarispay-sdk/react"`.
 *
 * Kept separate from the root export so that React stays an optional peer
 * dependency in fact and not just in package.json.
 */

export {
  PayWithPolarisBNPL,
  POLARIS_SEPOLIA,
} from "./components/PayWithPolarisBNPL.js";
export type { PayWithPolarisBNPLProps } from "./components/PayWithPolarisBNPL.js";
