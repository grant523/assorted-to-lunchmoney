// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/scrapers/cash-flow-history.ts
// biome-ignore-all lint/style/noNonNullAssertion: 3rd party code

import { details, info, warn } from '@repo/logger'
import { stringify } from 'csv-stringify/sync'
import type { Locator, Page } from 'playwright'

import { mfUrls } from '../urls.ts'

const TEXT_TIMEOUT = 1000
const SUMMARY_TIMEOUT = 3000
const PAYWALL_CHECK_TIMEOUT = 1500

// Money Forward's own CSV export is Premium-only, so rows are read straight out of
// the #cf-detail-table instead. Column names/order match Money Forward's export
// format so the existing importer (money-forward/importer.ts) needs no change
const CSV_COLUMNS = ['計算対象', '日付', '内容', '金額（円）', '保有金融機関', '大項目', '中項目', 'メモ', '振替', 'ID']

interface ScrapedTransactionRow {
    isTarget: boolean
    date: string
    description: string
    amount: number
    institution: string
    category: string
    subcategory: string
    memo: string
    isTransfer: boolean
    id: string
}

/** 「プレミアムユーザー限定の機能です」ダイアログが表示されているか判定 */
async function isPremiumPaywallVisible(page: Page): Promise<boolean> {
    try {
        await page.getByText('プレミアムユーザー限定の機能').first().waitFor({
            state: 'visible',
            timeout: PAYWALL_CHECK_TIMEOUT,
        })
        return true
    } catch {
        return false
    }
}

async function getOptionalText(locator: Locator, timeout = TEXT_TIMEOUT): Promise<string | null> {
    if ((await locator.count()) === 0) return null
    const text = await locator.first().textContent({ timeout })
    return text?.trim() ?? ''
}

async function getOptionalAttribute(locator: Locator, name: string): Promise<string | null> {
    if ((await locator.count()) === 0) return null
    return locator.first().getAttribute(name)
}

/**
 * CSV linkから現在表示中の月を取得
 */
async function getMonthFromCsvLink(page: Page): Promise<string | null> {
    const csvLink = await getOptionalAttribute(page.locator("a[href*='/cf/csv']").first(), 'href')
    const yearMatch = csvLink?.match(/year=(\d{4})/)
    const monthMatch = csvLink?.match(/month=(\d{1,2})/)
    if (yearMatch && monthMatch) {
        return `${yearMatch[1]}-${monthMatch[1]?.padStart(2, '0')}`
    }
    return null
}

/**
 * ページから表示中の月を検出する
 */
async function detectMonth(page: Page): Promise<{ year: number; month: number }> {
    let year = new Date().getFullYear()
    let month = new Date().getMonth() + 1

    // Try 1: fc-header-title (FullCalendar style)
    const headerTitle = await getOptionalText(page.locator('.fc-header-title h2'), SUMMARY_TIMEOUT)
    let match = headerTitle?.match(/(\d{4})年(\d{1,2})月/)

    // Try 2: Look for date display in other formats
    if (!match) {
        const pageText = await getOptionalText(page.locator(".heading-small, .month-title, [class*='month']").first())
        match = pageText?.match(/(\d{4})年(\d{1,2})月/) || pageText?.match(/(\d{4})\/(\d{1,2})/)
    }

    // Try 3: Get from CSV download link URL
    if (!match) {
        const csvLink = await getOptionalAttribute(page.locator("a[href*='/cf/csv']").first(), 'href')
        const yearMatch = csvLink?.match(/year=(\d{4})/)
        const monthMatch = csvLink?.match(/month=(\d{1,2})/)
        if (yearMatch && monthMatch) {
            return { year: parseInt(yearMatch[1]!, 10), month: parseInt(monthMatch[1]!, 10) }
        }
    }

    if (match) {
        year = parseInt(match[1]!, 10)
        month = parseInt(match[2]!, 10)
    }

    return { year, month }
}

/**
 * #cf-detail-table の各行を取引データとして読み取る
 */
async function scrapeTransactionRows(page: Page): Promise<ScrapedTransactionRow[]> {
    // biome-ignore lint/suspicious/noExplicitAny: runs in browser context, no types
    return page.locator('#cf-detail-table').evaluate((table: any) => {
        const rows = Array.from(table.querySelectorAll('tr.transaction_list'))
        return rows.map((tr: any) => {
            const isTarget =
                tr.querySelector('input[name="user_asset_act[is_target]"]')?.value === '1' ||
                tr.querySelector('input[name="user_asset_act[is_target]"]')?.getAttribute('value') === '1'
            const sortValue = tr.querySelector('td.date')?.getAttribute('data-table-sortable-value') || ''
            const date = sortValue.split('-')[0] || ''
            const description = tr.querySelector('td.content span')?.textContent?.trim() || ''
            const amountText = tr.querySelector('td.amount span.offset')?.textContent?.trim() || '0'
            const amount = parseInt(amountText.replace(/,/g, ''), 10)
            const institution = tr.querySelector('td.note.calc')?.textContent?.trim() || ''
            const category = tr.querySelector('td.lctg a.v_l_ctg')?.textContent?.trim() || ''
            const subcategory = tr.querySelector('td.mctg a.v_m_ctg')?.textContent?.trim() || ''
            const memo = tr.querySelector('td.memo span')?.textContent?.trim() || ''
            const transferLink =
                tr.querySelector('.js-switch-transfer')?.getAttribute('data-link') ||
                tr.querySelector('.js-switch-transfer')?.getAttribute('href') ||
                ''
            const isTransfer = transferLink.includes('disable_transfer')
            return {
                isTarget,
                date,
                description,
                amount,
                institution,
                category,
                subcategory,
                memo,
                isTransfer,
                id: tr.id.replace('js-transaction-', ''),
            }
        })
    })
}

/**
 * 過去N月分の家計簿データを取得
 * UIの前月ボタンをクリックして月を切り替えながら取得
 */
export async function scrapeCashFlowHistory(page: Page, monthsToScrape: number = 24): Promise<string[]> {
    info(`Scraping cash flow history for ${details(monthsToScrape)} months...`)

    await page.goto(mfUrls.cashFlow, { waitUntil: 'domcontentloaded' })
    // テーブルが表示されるまで待機
    await page.locator('#cf-detail-table').waitFor({ state: 'visible', timeout: 10000 })

    const results: string[] = []

    for (let i = 0; i < monthsToScrape; i++) {
        const { year, month } = await detectMonth(page)
        const date = `${year}-${month.toString().padStart(2, '0')}`

        info(`Scraping %s...`, details(date))
        const rows = await scrapeTransactionRows(page)
        const records = rows.map((row) => ({
            計算対象: row.isTarget ? '1' : '0',
            日付: row.date,
            内容: row.description,
            '金額（円）': row.amount,
            保有金融機関: row.institution,
            大項目: row.category,
            中項目: row.subcategory,
            メモ: row.memo,
            振替: row.isTransfer ? '1' : '0',
            ID: row.id,
        }))

        const path = `data/money-forward/${date}.csv`
        const csv = stringify(records, { header: true, columns: CSV_COLUMNS })
        await Bun.write(path, csv)
        info(`Wrote %s transactions to %s`, details(records.length), details(path))
        results.push(path)

        if (i < monthsToScrape - 1) {
            const currentMonth = await getMonthFromCsvLink(page)
            const prevButton = page.locator('button.fc-button-prev, span.fc-button-prev').first()
            await prevButton.click()

            if (await isPremiumPaywallVisible(page)) {
                warn(`Premium subscription required to view data before %s; stopping history scrape.`, details(date))
                break
            }

            // 月が変わるまで待機（CSV linkのURLパラメータで判定）
            // MoneyForwardは無料プランだと古い月への遷移がダイアログ無しで
            // 単に無視されることがあるため、タイムアウトはエラーにせず終了扱い
            const monthChanged = await page
                .waitForFunction(
                    (prevMonth) => {
                        // @ts-expect-error-next-line
                        const link = document.querySelector("a[href*='/cf/csv']")
                        if (!link) return false
                        const href = link.getAttribute('href') || ''
                        const yearMatch = href.match(/year=(\d{4})/)
                        const monthMatch = href.match(/month=(\d{1,2})/)
                        if (!yearMatch || !monthMatch) return false
                        const newMonth = `${yearMatch[1]}-${monthMatch[1].padStart(2, '0')}`
                        return newMonth !== prevMonth
                    },
                    currentMonth,
                    { timeout: 10000 }
                )
                .then(() => true)
                .catch(() => false)

            if (!monthChanged) {
                warn(
                    `Could not navigate to a month before %s (likely a Money Forward limit); stopping history scrape.`,
                    details(date)
                )
                break
            }

            await page.locator('#cf-detail-table').waitFor({ state: 'visible', timeout: 10000 })
        }
    }

    return results
}
