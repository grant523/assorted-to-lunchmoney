import { parseArgs } from 'node:util'

export interface CliOptions {
    nonInteractive: boolean
    scrape?: boolean
    headless: boolean
    rematch: boolean
    help: boolean
}

export function printHelp(): void {
    console.log(`
Usage: bun start [options]

Options:
  -y, --non-interactive    Run unattended without interactive prompts (defaults to true in non-TTY environments)
  --interactive            Force interactive prompts even when running in non-TTY environments
  --scrape                 Force scraping updates from Money Forward
  --no-scrape              Skip scraping Money Forward updates
  --headless               Run browser scraper headlessly (default: true)
  --no-headless, --headed  Run browser scraper with visible Chromium window
  --rematch                Force rematching of Lunch Money accounts
  -h, --help               Show this help message

Environment variables (.env):
  NON_INTERACTIVE=true     Run unattended without interactive prompts
  SCRAPE=true|false        Control scraping Money Forward updates
  HEADLESS=true|false      Control browser scraper headless mode (default: true)
  REMATCH=true             Force rematching of accounts
`)
}

export function parseCliArgs(
    args: string[] = Bun.argv.slice(2),
    env: Record<string, string | undefined> = Bun.env,
    isTTY: boolean = Boolean(process.stdin?.isTTY)
): CliOptions {
    const { values } = parseArgs({
        args,
        options: {
            'non-interactive': { type: 'boolean', short: 'y' },
            interactive: { type: 'boolean' },
            scrape: { type: 'boolean' },
            'no-scrape': { type: 'boolean' },
            headless: { type: 'boolean' },
            'no-headless': { type: 'boolean' },
            headed: { type: 'boolean' },
            rematch: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
        strict: false,
    })

    const help = Boolean(values.help)

    // Determine nonInteractive mode
    let nonInteractive: boolean
    if (values['non-interactive'] !== undefined) {
        nonInteractive = Boolean(values['non-interactive'])
    } else if (values.interactive !== undefined) {
        nonInteractive = !values.interactive
    } else if (env.NON_INTERACTIVE !== undefined) {
        nonInteractive = env.NON_INTERACTIVE === 'true' || env.NON_INTERACTIVE === '1'
    } else {
        nonInteractive = !isTTY
    }

    // Determine scrape preference
    let scrape: boolean | undefined
    if (values['no-scrape']) {
        scrape = false
    } else if (values.scrape) {
        scrape = true
    } else if (env.SCRAPE !== undefined) {
        scrape = env.SCRAPE === 'true' || env.SCRAPE === '1'
    } else if (nonInteractive) {
        scrape = true
    } else {
        scrape = undefined // prompt user
    }

    // Determine headless preference (defaults to true)
    let headless = true
    if (values['no-headless'] || values.headed) {
        headless = false
    } else if (values.headless) {
        headless = true
    } else if (env.HEADLESS !== undefined) {
        headless = env.HEADLESS !== 'false' && env.HEADLESS !== '0'
    }

    // Determine rematch preference
    let rematch = false
    if (values.rematch) {
        rematch = true
    } else if (env.REMATCH !== undefined) {
        rematch = env.REMATCH === 'true' || env.REMATCH === '1'
    }

    return {
        nonInteractive,
        scrape,
        headless,
        rematch,
        help,
    }
}

