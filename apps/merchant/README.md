# 🏪 Polaris Merchant App

The **Polaris Merchant App** is a dedicated portal for businesses to manage their crypto settlements, integration keys, and payment analytics within the Polaris ecosystem. It provides the necessary tools to onboard merchants into the future of decentralized e-commerce.

## 🚀 Key Features
- **Merchant Dashboard**: Real-time overview of payments, total volume, and pending settlements.
- **Integration Management**: Generate and manage API credentials for the Polaris Checkout integration.
- **Settlement Tracking**: Monitor automated settlements and manual withdrawals.
- **Analytics**: Detailed reports on customer payment behavior and asset preferences.

## 🛠️ Tech Stack
- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Styling**: Tailwind CSS
- **Data Layer**: Convex & Supabase
- **UI Components**: Shadcn UI & Framer Motion

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## 📁 Directory Structure
- `app/`: Main dashboard, settings, and settlement pages.
- `components/`: UI components for charts, tables, and merchant forms.
- `hooks/`: Integration hooks for the Polaris API.
- `lib/`: Business logic for merchant authentication and data processing.

## 🔒 Integration Role
The Merchant App coordinates with the `polaris-core` API to create bills and authorize checkout sessions for external storefronts like Shopify.

---

## ⚙️ Chain configuration
The app reads Solana devnet through the gateway; the deployed program id and
cluster live in the workspace's `deployments/`. It builds no transaction and
holds no key — a merchant's trade is public state under their own address, so
the dashboard is read-only by construction.

An earlier version of this app was wired to Fhenix Sepolia contracts. That is
no longer the case anywhere in this repository.

