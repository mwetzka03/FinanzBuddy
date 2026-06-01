# FinanzBuddy

**Offline-first personal finance desktop app for Windows.** Track accounts, transactions, fixed and variable costs, income forecasts, a shopping list, and a stock portfolio — all stored locally on your machine.

Built with **Tauri 2**, **React**, and **SQLite**.

## Features

- Multi-account ledger with transfers and balance corrections
- Fixed costs, variable budgets, and income forecasts
- Shopping list with optional same-day booking
- Stock portfolio with live quotes and news
- German / English UI, light / dark theme
- No cloud account required — your data stays on your PC

## Download (end users)

Releases are published on GitHub. Download **`FinanzBuddy.exe`** (or the NSIS installer) from the [Releases](../../releases) page — **no Node.js or Rust installation needed**.

1. Open the latest release for your tag (e.g. `v0.1.0`)
2. Download the Windows asset
3. Run the `.exe`

## Develop locally

Requirements: [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

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

Output: `release/FinanzBuddy.exe`

## Data conventions

- **Money** is stored as integer **cents** (`amountCents`)
- **Dates** as ISO `YYYY-MM-DD`
- **Months** as ISO `YYYY-MM`

## License

Private / personal project — adjust before publishing if you open-source it.
