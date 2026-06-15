# FinanzBuddy

**Offline-first personal finance desktop app for Windows.** Track accounts, transactions, fixed and variable costs, budget pools, income forecasts, a shopping list, and a stock portfolio — all stored locally on your machine.

Built with **Tauri 2**, **React**, and **SQLite**.

## Features

### Core ledger

- Multi-account ledger (checking, savings pots, depot-linked accounts)
- Transfers, balance corrections, and bank import (CSV/CAMT)
- Append-only follow-up bank import after initial setup
- Transaction search on Dashboard and Transactions pages
- Category assignment: variable costs, fixed costs, shopping-list items/groups
- Manual splits for variable costs and budget-pool assignments on one expense

### Planning & budgets

- **Fixed costs** — recurring debits with calendar or business-day due rules
- **Variable costs** — monthly budget lines with forecast vs. actual from categorized transactions
- **Budget pools** — free budgets per salary period or calendar year; optional **scalable** carry-over of remaining budget into the next period; period history popup
- **Income forecasts** — recurring income with optional actual linking
- **Shopping list** — planned purchases with groups, total/open amount columns, optional same-day booking, clickable product links

### Dashboard & UX

- Salary-period or calendar-month dashboard with liquidity chain
- German / English UI, light / dark theme
- Lottie loading animation, structured error dialog with downloadable dev report
- Amount-column band styling in tables; improved paginator layout with search

### Stocks

- Stock portfolio with live quotes and news carousel
- Buy/sell tracking linked to ledger accounts

### Privacy

- No cloud account required — your data stays on your PC
- Local SQLite database in the app data directory

## Download (end users)

Releases are published on GitHub. Download **`FinanzBuddy.exe`** (portable) or the **NSIS installer** from the [Releases](../../releases) page — **no Node.js or Rust installation needed**.

1. Open the latest release (e.g. `v0.3.5`)
2. Download the Windows asset
3. Run the `.exe` or installer

## Develop locally

Requirements: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) stable, and [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

**Windows shortcut:**

```powershell
.\scripts\dev-app.ps1
# or
npm run dev:win
```

## Build release EXE

```powershell
.\scripts\build-app.ps1
# or
npm run build:win
```

Output: `release/FinanzBuddy.exe` (and NSIS installer under `src-tauri/target/release/bundle/nsis/`)

## Project structure

| Area | Path |
|------|------|
| React UI | `src/` |
| Tauri / Rust backend | `src-tauri/src/` |
| SQLite migrations | `src-tauri/src/db.rs` |
| i18n (DE/EN) | `src/i18n/locales/` |
| Release notes | `.github/release-notes/` |
| CI release workflow | `.github/workflows/release.yml` |

## Data conventions

- **Money** is stored as integer **cents** (`amountCents`)
- **Dates** as ISO `YYYY-MM-DD`
- **Months** as ISO `YYYY-MM`
- Budget pool periods use keys like `2026-05-15:2026-06-14` (salary period) or `2026` (yearly)

## Releasing

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
2. Add `.github/release-notes/vX.Y.Z.md` (English)
3. Merge to `main`, tag `vX.Y.Z`, and push the tag — GitHub Actions builds and publishes the release

## License

Private / personal project — adjust before publishing if you open-source it.
