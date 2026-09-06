import { confirm } from '@inquirer/prompts'
import { type InsertTransaction, LunchMoneyError, type User } from '@lunch-money/lunch-money-js-v2'
import { details, error, info, warn } from '@repo/logger'

import { syncMoneyForwardAccounts, syncRevolutAccounts } from './accounts.ts'
import { parseCliArgs, printHelp } from './cli.ts'
import { loadTransactions as loadMoneyForwardTransactions } from './money-forward/importer.ts'
import { loadTransactions as loadRevolutTransactions, RevolutTransactionState } from './revolut/importer.ts'
import { scrape } from './scraper.ts'
import { lm, setup } from './setup.ts'

const cliOptions = parseCliArgs()

if (cliOptions.help) {
    printHelp()
    process.exit(0)
}

setup()

// Get current user
const userData: User = await lm.user.getMe()
info(`Current user: %s | %s`, details(userData.name), details(userData.email))

await processMoneyForward()
await processRevolut()

async function insertTransactionsBatch(
    transactions: InsertTransaction[],
    batchSize: number = 500
): Promise<{ inserted: number; skipped: number }> {
    let totalInserted = 0
    let totalSkipped = 0

    for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize)

        if (batch.length === 0) {
            continue
        }

        const result = await lm.transactions.create({
            transactions: batch,
            skip_duplicates: false,
            apply_rules: true,
        })

        totalInserted += result.transactions.length
        totalSkipped += result.skipped_duplicates.length

        info(
            `Batch %s: Inserted %s, Skipped %s duplicates`,
            details(Math.floor(i / batchSize) + 1),
            details(result.transactions.length),
            details(result.skipped_duplicates.length)
        )
    }

    return { inserted: totalInserted, skipped: totalSkipped }
}

async function processMoneyForward() {
    let shouldScrape: boolean
    if (cliOptions.scrape !== undefined) {
        shouldScrape = cliOptions.scrape
    } else {
        shouldScrape = await confirm({
            message: 'Scrape updates from Money Forward?',
            default: false,
        })
    }

    if (shouldScrape) {
        info(`Scraping from Money Forward (headless: %s)...`, details(cliOptions.headless))
        await scrape({ headless: cliOptions.headless })
    }

    info(`Syncing Money Forward accounts`)
    const mfNameToLmId: Map<string, number> = new Map(
        (
            await syncMoneyForwardAccounts({
                nonInteractive: cliOptions.nonInteractive,
                rematch: cliOptions.rematch,
            })
        ).map((it) => [it.account_name, it.lm_id])
    )

    info(`Loading transactions from CSV files...`)
    const mfTransactions = await loadMoneyForwardTransactions(18)
    info(`Loaded %s transactions`, details(mfTransactions.length))

    try {
        info(`Inserting transactions into Lunch Money...`)

        const lmTransactions: InsertTransaction[] = []
        let unmappedCount = 0
        const unmappedInstitutions = new Set<string>()

        for (const t of mfTransactions) {
            const manualAccountId = mfNameToLmId.get(t.institution)
            if (manualAccountId === undefined) {
                unmappedCount++
                unmappedInstitutions.add(t.institution)
                continue
            }
            lmTransactions.push({
                manual_account_id: manualAccountId,
                date: t.date.replace(/\//g, '-'),
                amount: -t.amount,
                payee: t.description.slice(0, 140),
                notes: t.description,
                external_id: t.id,
            })
        }

        if (unmappedCount > 0) {
            warn(
                'Skipped %s transactions for unmapped Money Forward institutions: %s',
                details(unmappedCount),
                details([...unmappedInstitutions].join(', '))
            )
        }

        const { inserted, skipped } = await insertTransactionsBatch(lmTransactions)

        info(`Complete! Inserted %s transactions, skipped %s duplicates`, details(inserted), details(skipped))
        info(`Done!`)
    } catch (e) {
        if (e instanceof LunchMoneyError) {
            error(`Error inserting transactions: ${details(e.message)}`, e.errors)
            process.exit(1)
        } else {
            throw e
        }
    }
}

async function processRevolut() {
    info(`Loading transactions from CSV files...`)
    const unfilteredRevolutTransactions = await loadRevolutTransactions()
    const revolutTransactions = unfilteredRevolutTransactions.filter(
        (it) => it.state === RevolutTransactionState.COMPLETED
    )
    info(`Loaded %s completed transactions`, details(revolutTransactions.length))

    info(`Syncing Revolut accounts`)
    const accounts = [...new Set(unfilteredRevolutTransactions.map((it) => it.currency))]
    const revolutNameToLmId: Map<string, number> = new Map(
        (
            await syncRevolutAccounts(accounts, {
                nonInteractive: cliOptions.nonInteractive,
                rematch: cliOptions.rematch,
            })
        ).map((it) => [it.account_name, it.lm_id])
    )

    try {
        info(`Inserting transactions into Lunch Money...`)

        const lmTransactions: InsertTransaction[] = []
        let unmappedCount = 0
        const unmappedCurrencies = new Set<string>()

        for (const t of revolutTransactions) {
            const manualAccountId = revolutNameToLmId.get(t.currency)
            if (manualAccountId === undefined) {
                unmappedCount++
                unmappedCurrencies.add(t.currency)
                continue
            }
            lmTransactions.push({
                manual_account_id: manualAccountId,
                date: t.startedDate.substring(0, 10),
                amount: -t.amount - t.fee,
                payee: t.description.slice(0, 140),
                notes: t.description,
                external_id: t.externalId,
            })
        }

        if (unmappedCount > 0) {
            warn(
                'Skipped %s transactions for unmapped Revolut currencies: %s',
                details(unmappedCount),
                details([...unmappedCurrencies].join(', '))
            )
        }

        const { inserted, skipped } = await insertTransactionsBatch(lmTransactions)

        info(`Complete! Inserted %s transactions, skipped %s duplicates`, details(inserted), details(skipped))
        info(`Done!`)
    } catch (e) {
        if (e instanceof LunchMoneyError) {
            error(`Error inserting transactions: ${details(e.message)}`, e.errors)
            process.exit(1)
        } else {
            throw e
        }
    }
}
