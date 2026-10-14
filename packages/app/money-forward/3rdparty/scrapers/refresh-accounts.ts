// biome-ignore-all lint/style/noNonNullAssertion: 3rd party code
// biome-ignore-all lint/suspicious/noExplicitAny: 3rd party code

import { details, info, warn } from '@repo/logger'
import type { Page } from 'playwright'

import { mfUrls } from '../urls.ts'

export interface RefreshAccountsOptions {
    /** Timeout in milliseconds to wait for accounts to finish updating (default: 120_000 = 2 minutes) */
    timeoutMs?: number
    /** Interval in milliseconds between status polling checks (default: 5_000 = 5 seconds) */
    pollIntervalMs?: number
}

export interface AccountRefreshStatus {
    name: string
    hash: string
    status: 'ok' | 'error' | 'timeout' | 'updating'
    lastUpdated?: string
    message?: string
}

const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const DEFAULT_POLL_INTERVAL_MS = 5_000 // 5 seconds

/**
 * Triggers refresh for all auto-linked accounts on Money Forward
 * and polls until they finish updating or timeout is reached.
 */
export async function refreshAccounts(
    page: Page,
    options: RefreshAccountsOptions = {}
): Promise<AccountRefreshStatus[]> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

    info('Navigating to accounts page for refresh...')
    await page.goto(mfUrls.accounts, { waitUntil: 'domcontentloaded' })
    await page.locator('#account-table').first().waitFor({ state: 'visible', timeout: 10_000 })

    // Register dialog handler to auto-accept any alerts/confirms
    const dialogHandler = async (dialog: any) => {
        info('Dialog appeared during refresh: %s', details(dialog.message()))
        await dialog.accept()
    }
    page.on('dialog', dialogHandler)

    try {
        const rows = page.locator('#account-table tbody tr')
        const rowCount = await rows.count()

        const accountsToTrack: Array<{
            name: string
            hash: string
        }> = []

        // Find each auto-linked account and trigger refresh
        for (let i = 1; i < rowCount; i++) {
            const row = rows.nth(i)
            const form = row.locator('form[action^="/faggregation_queue2/"]').first()
            if ((await form.count()) === 0) {
                // Not an auto-linked account with refresh capabilities
                continue
            }

            const action = (await form.getAttribute('action')) || ''
            const hashMatch = action.match(/\/faggregation_queue2\/([^/?]+)/)
            const hash = hashMatch ? hashMatch[1]! : ''

            // Extract visible account name
            const nameLink = row.locator('td.service a[href*="/accounts/show"], td:first-child a').first()
            let name = ''
            if ((await nameLink.count()) > 0) {
                name = (await nameLink.innerText().catch(() => ''))?.trim()
            }
            if (!name) {
                const firstCell = await row
                    .locator('td')
                    .first()
                    .innerText()
                    .catch(() => '')
                name = firstCell.split(/[\n\r]/)[0]?.trim() || `Account-${i}`
            }

            // Check current visible status (must use innerText, not textContent,
            // because hidden elements contain '更新中' span with display: none)
            const statusCell = row.locator('td.account-status, td:nth-child(4)').first()
            const statusText = (await statusCell.innerText().catch(() => ''))?.trim() || ''
            const isAlreadyUpdating = statusText.includes('更新中')

            accountsToTrack.push({ name, hash })

            if (isAlreadyUpdating) {
                info('Account %s is already updating...', details(name))
                continue
            }

            const submitBtn = form.locator('input[type="submit"][value="更新"]')
            if (await submitBtn.isVisible().catch(() => false)) {
                info('Triggering refresh for %s...', details(name))
                await submitBtn.click().catch((err) => {
                    warn('Failed to click refresh for %s: %s', details(name), details(err.message))
                })
                // Brief pause between requests
                await page.waitForTimeout(1000)
            } else {
                warn('Refresh button for %s is not visible', details(name))
            }
        }

        if (accountsToTrack.length === 0) {
            info('No auto-linked accounts found to refresh.')
            return []
        }

        info(
            'Waiting for %s account(s) to finish updating (timeout: %ss)...',
            details(accountsToTrack.length),
            details(Math.round(timeoutMs / 1000))
        )

        // Poll until all accounts finish updating or timeout
        const startTime = Date.now()
        let pollCount = 0

        while (Date.now() - startTime < timeoutMs) {
            await page.waitForTimeout(pollIntervalMs)
            pollCount++

            try {
                await page.goto(mfUrls.accounts, { waitUntil: 'domcontentloaded' })
                await page.locator('#account-table').first().waitFor({ state: 'visible', timeout: 10_000 })
            } catch (err: any) {
                warn('Transient navigation error during poll: %s', details(err.message))
                continue
            }

            // Check current statuses
            const currentStatuses = await getAccountStatuses(page)
            const stillUpdating: string[] = []

            for (const acc of accountsToTrack) {
                const current = currentStatuses.get(acc.hash) || currentStatuses.get(acc.name)
                if (!current || current.status === 'updating') {
                    stillUpdating.push(acc.name)
                }
            }

            const elapsedSec = Math.round((Date.now() - startTime) / 1000)

            if (stillUpdating.length === 0) {
                info('All %s accounts finished updating in %ss!', details(accountsToTrack.length), details(elapsedSec))
                break
            }

            info(
                'Poll #%s (%ss): %s account(s) still updating (%s)...',
                details(pollCount),
                details(elapsedSec),
                details(stillUpdating.length),
                details(stillUpdating.join(', '))
            )
        }

        // Final status collection
        const finalStatuses = await getAccountStatuses(page)
        const results: AccountRefreshStatus[] = accountsToTrack.map((acc) => {
            const current = finalStatuses.get(acc.hash) || finalStatuses.get(acc.name)
            if (!current) {
                return {
                    name: acc.name,
                    hash: acc.hash,
                    status: 'error',
                    message: 'Status not found after refresh',
                }
            }
            if (current.status === 'updating') {
                return {
                    name: acc.name,
                    hash: acc.hash,
                    status: 'timeout',
                    message: 'Timed out waiting for update to complete',
                }
            }
            return {
                name: acc.name,
                hash: acc.hash,
                status: current.status,
                lastUpdated: current.lastUpdated,
                message: current.errorMessage,
            }
        })

        for (const res of results) {
            if (res.status === 'ok') {
                info('✓ %s: updated successfully (%s)', details(res.name), details(res.lastUpdated || 'OK'))
            } else if (res.status === 'timeout') {
                warn('⚠ %s: still updating after timeout', details(res.name))
            } else {
                warn('✗ %s: status %s (%s)', details(res.name), details(res.status), details(res.message || 'Error'))
            }
        }

        return results
    } finally {
        page.off('dialog', dialogHandler)
    }
}

/**
 * Extracts current status and last updated timestamps from the accounts table.
 * Uses visible innerText to properly distinguish active '更新中' from hidden placeholder spans.
 */
async function getAccountStatuses(page: Page): Promise<
    Map<
        string,
        {
            name: string
            status: 'ok' | 'error' | 'updating'
            lastUpdated: string
            errorMessage?: string
        }
    >
> {
    const statusMap = new Map<
        string,
        {
            name: string
            status: 'ok' | 'error' | 'updating'
            lastUpdated: string
            errorMessage?: string
        }
    >()

    const rows = page.locator('#account-table tbody tr')
    const count = await rows.count()

    for (let i = 1; i < count; i++) {
        const row = rows.nth(i)
        const cells = row.locator('td')
        const cellCount = await cells.count()
        if (cellCount < 3) continue

        // Extract account name from link or first cell
        const nameLink = row.locator('td.service a[href*="/accounts/show"], td:first-child a').first()
        let name = ''
        if ((await nameLink.count()) > 0) {
            name = (await nameLink.innerText().catch(() => ''))?.trim()
        }
        if (!name) {
            const nameCell =
                (
                    await cells
                        .nth(0)
                        .innerText()
                        .catch(() => '')
                )?.trim() || ''
            name = nameCell.split(/[\n\r]/)[0]?.trim() || ''
        }
        if (!name || name === '登録名' || name === '金融機関') continue

        const dateCell =
            (
                await cells
                    .nth(2)
                    .innerText()
                    .catch(() => '')
            )?.trim() || ''
        const statusCell =
            cellCount >= 4
                ? (
                      await row
                          .locator('td.account-status, td:nth-child(4)')
                          .first()
                          .innerText()
                          .catch(() => '')
                  )?.trim() || ''
                : ''

        // Find hash from form action
        const formAction =
            (await row
                .locator('form[action^="/faggregation_queue2/"]')
                .first()
                .getAttribute('action')
                .catch(() => '')) || ''
        const hashMatch = formAction.match(/\/faggregation_queue2\/([^/?]+)/)
        const hash = hashMatch ? hashMatch[1]! : ''

        let status: 'ok' | 'error' | 'updating' = 'ok'
        let errorMessage: string | undefined

        if (statusCell.includes('更新中')) {
            status = 'updating'
            errorMessage = statusCell
        } else if (statusCell.includes('正常')) {
            status = 'ok'
        } else if (statusCell) {
            status = 'error'
            errorMessage = statusCell
        }

        const lastUpdatedMatch = dateCell.match(/\(([^)]+)\)/)
        const lastUpdated = lastUpdatedMatch ? lastUpdatedMatch[1]! : dateCell

        const item = { name, status, lastUpdated, errorMessage }
        if (hash) statusMap.set(hash, item)
        statusMap.set(name, item)
    }

    return statusMap
}
