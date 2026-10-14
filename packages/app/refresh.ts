import { details, info } from '@repo/logger'

import { parseCliArgs, printHelp } from './cli.ts'
import { refreshOnly } from './scraper.ts'
import { setup } from './setup.ts'

const cliOptions = parseCliArgs()

if (cliOptions.help) {
    printHelp()
    process.exit(0)
}

setup()

info('Starting Money Forward account refresh (headless: %s)...', details(cliOptions.headless))
const results = await refreshOnly({ headless: cliOptions.headless })

const okCount = results.filter((r) => r.status === 'ok').length
info('Refresh complete: %s/%s accounts successfully updated.', details(okCount), details(results.length))
