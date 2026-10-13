# Money Forward → Lunch Money Importer

Syncs financial transactions from Money Forward and Revolut into Lunch Money.

## Overview

This tool automates the process of importing transactions from multiple sources into Lunch Money:

- **Money Forward**: Scrapes transaction data using Playwright
- **Revolut**: Imports transactions from CSV exports. This is manual at the moment and needs the statements downloaded from the Revolut website in Excel (CSV) format.

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Lunch Money account with API key
- Money Forward account
- Revolut CSV exports (optional)

### Installation

```bash
bun install
```

### Configuration

Create `.env` file in `packages/app/`:

```bash
cp packages/app/.env.example packages/app/.env
```

Configure the following variables:

```env
# Lunch Money
LUNCH_MONEY_API_KEY=your_api_key

# Money Forward
MONEY_FORWARD_EMAIL_ADDRESS=your_email
MONEY_FORWARD_AUTH_PASSWORD=your_password
MONEY_FORWARD_OTPAUTH_URI=otpauth://...
```

### Data Directory Setup

Place your financial data in the appropriate directories:

```
packages/app/data/
├── money-forward/    # CSV exports from Money Forward
└── revolut/          # CSV exports from Revolut
```

## Usage

### Interactive Mode

Run the importer interactively:

```bash
bun start
```

### Daily Background Job / Non-Interactive Mode

Run unattended (e.g. from `cron` or `launchd`):

```bash
bun start -- -y
# or
bun start -- --non-interactive
# or set NON_INTERACTIVE=true in packages/app/.env
```

When running non-interactively (or in non-TTY environments):
- Money Forward updates are scraped automatically
- Browser scraper runs headless by default
- Existing account mappings in SQLite are used without prompting
- Transactions for any unmapped accounts are safely skipped with a warning

### CLI Options

Pass options after `--`:

```bash
bun start -- [options]
```

| Option | Description |
|---|---|
| `-y`, `--non-interactive` | Run unattended without interactive prompts |
| `--interactive` | Force interactive prompts even in non-TTY environments |
| `--scrape` / `--no-scrape` | Explicitly enable or disable Money Forward scraping |
| `--headless` / `--no-headless` | Control headless browser scraping (defaults to `true`) |
| `--rematch` | Force rematching of Lunch Money accounts |
| `-h`, `--help` | Show help message |

The tool will:
1. Scrape updates from Money Forward (headless)
2. Sync accounts from Money Forward and Revolut to Lunch Money
3. Load transactions from CSV files
4. Import transactions in batches of 500
5. Skip duplicates based on external_id
6. Apply Lunch Money rules automatically

## Running with Docker (Synology NAS)

Running via Docker / Container Manager avoids installing Bun and Playwright browser dependencies directly on the Synology host OS.

### 1. Initial Setup on Synology
1. Copy this repository to your Synology (e.g. `/volume1/docker/assorted-to-lunchmoney/`).
2. Make sure your `.env` file is present in `packages/app/.env`.
3. Build the Docker image:
   ```bash
   cd /volume1/docker/assorted-to-lunchmoney
   docker compose build
   ```

### 2. Manual Test Run
Test that the importer runs non-interactively and exits when finished:
```bash
docker compose run --rm importer
```

### 3. Schedule Daily Run in Synology Task Scheduler
1. Open DSM **Control Panel → Task Scheduler**.
2. Click **Create → Scheduled Task → User-defined script**.
3. **General**:
   - Task: `Lunch Money Daily Importer`
   - User: `root`
4. **Schedule**:
   - Daily (e.g. at `06:00 AM`).
5. **Task Settings** (User-defined script):
   ```bash
   cd /volume1/docker/assorted-to-lunchmoney && /usr/local/bin/docker compose run --rm importer >> /volume1/docker/assorted-to-lunchmoney/cron.log 2>&1
   ```
6. Click **OK**.

## Project Structure

```
packages/
├── app/              # Main application
│   ├── money-forward/
│   │   ├── 3rdparty/    # Playwright scraper
│   │   └── importer.ts  # CSV importer
│   ├── revolut/
│   │   └── importer.ts  # CSV importer with validation
│   ├── accounts.ts      # Account sync logic
│   ├── index.ts         # Main entry point
│   └── setup.ts         # Configuration and initialization
└── logger/           # Logging utilities

```

## Features

- **Transaction validation**: Validates CSV data against expected formats with detailed error reporting
- **Duplicate detection**: Uses external_id hash to prevent duplicate imports
- **Batch processing**: Imports transactions in configurable batches (default: 500)
- **Account syncing**: Automatically creates/updates accounts in Lunch Money
- **State persistence**: Maintains authentication state for Money Forward scraping
- **Transaction filtering**: Only imports completed Revolut transactions

## Development

Lint and format code:

```bash
bun run lint
```

The project uses:
- Bun workspaces for monorepo management
- TypeScript for type safety
- Biome for linting and formatting
- Playwright for web scraping
- SQLite for local state persistence

## Attribution

The Money Forward scraping implementation is based on [hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard).
