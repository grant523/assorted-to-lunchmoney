import { info } from '@repo/logger'
import { chromium } from 'playwright'

import { saveAccounts } from './accounts.ts'
import { loginWithAuthState } from './money-forward/3rdparty/auth/login'
import { createBrowserContext } from './money-forward/3rdparty/browser/context'
import { scrapeCashFlowHistory } from './money-forward/3rdparty/scrapers/cash-flow-history.ts'
import { NO_GROUP_ID, switchGroup } from './money-forward/3rdparty/scrapers/group.ts'
import { refreshAccounts } from './money-forward/3rdparty/scrapers/refresh-accounts.ts'
import { getRegisteredAccounts } from './money-forward/3rdparty/scrapers/registered-accounts.ts'

export interface ScrapeOptions {
    headless?: boolean
    refresh?: boolean
}

export async function scrape({ headless = true, refresh = true }: ScrapeOptions = {}) {
    const browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    const context = await createBrowserContext(browser, { useAuthState: true })
    const page = await context.newPage()

    info(`Logging into Money Forward...`)
    await loginWithAuthState(page, context)

    await switchGroup(page, NO_GROUP_ID)

    if (refresh) {
        info(`Refreshing linked accounts in Money Forward...`)
        await refreshAccounts(page)
    }

    const mfAccounts = await getRegisteredAccounts(page)
    await saveAccounts(mfAccounts.accounts)

    await scrapeCashFlowHistory(page)

    info(`Closing...`)

    await browser.close()
}

export async function refreshOnly({ headless = true }: { headless?: boolean } = {}) {
    const browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    const context = await createBrowserContext(browser, { useAuthState: true })
    const page = await context.newPage()

    info(`Logging into Money Forward...`)
    await loginWithAuthState(page, context)

    await switchGroup(page, NO_GROUP_ID)

    info(`Refreshing linked accounts in Money Forward...`)
    const results = await refreshAccounts(page)

    info(`Closing...`)

    await browser.close()
    return results
}
