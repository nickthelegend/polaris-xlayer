/**
 * Headless entry point. Deliberately free of React.
 *
 * The React widget lives behind `polarispay-sdk/react` rather than here,
 * because a barrel that re-exports it makes React a hard requirement of every
 * import -- a Node backend calling `createPolaris` would fail to resolve
 * `react/jsx-runtime` before running a line. Splitting the entry points is what
 * makes the optional peer dependency actually optional.
 */

export { createPolaris, SEPOLIA } from "./polaris.js";
export type {
  CreditProfile,
  Polaris,
  PolarisContracts,
  PolarisOptions,
  Result,
} from "./polaris.js";
