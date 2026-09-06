import { describe, expect, test } from 'bun:test'
import { parseCliArgs } from './cli.ts'

describe('parseCliArgs', () => {
    test('defaults to interactive with prompt for scrape in TTY environment', () => {
        const options = parseCliArgs([], {}, true)
        expect(options.nonInteractive).toBe(false)
        expect(options.scrape).toBeUndefined() // indicates user should be prompted
        expect(options.headless).toBe(true)
        expect(options.rematch).toBe(false)
        expect(options.help).toBe(false)
    })

    test('defaults to non-interactive and auto-scrape in non-TTY environment', () => {
        const options = parseCliArgs([], {}, false)
        expect(options.nonInteractive).toBe(true)
        expect(options.scrape).toBe(true)
        expect(options.headless).toBe(true)
    })

    test('--non-interactive flag forces non-interactive mode and auto-scrape', () => {
        const options = parseCliArgs(['--non-interactive'], {}, true)
        expect(options.nonInteractive).toBe(true)
        expect(options.scrape).toBe(true)
    })

    test('-y short flag forces non-interactive mode', () => {
        const options = parseCliArgs(['-y'], {}, true)
        expect(options.nonInteractive).toBe(true)
        expect(options.scrape).toBe(true)
    })

    test('--interactive overrides non-TTY environment', () => {
        const options = parseCliArgs(['--interactive'], {}, false)
        expect(options.nonInteractive).toBe(false)
        expect(options.scrape).toBeUndefined()
    })

    test('NON_INTERACTIVE=true env var sets non-interactive mode', () => {
        const options = parseCliArgs([], { NON_INTERACTIVE: 'true' }, true)
        expect(options.nonInteractive).toBe(true)
        expect(options.scrape).toBe(true)
    })

    test('--no-scrape disables scraping even in non-interactive mode', () => {
        const options = parseCliArgs(['--non-interactive', '--no-scrape'], {}, true)
        expect(options.nonInteractive).toBe(true)
        expect(options.scrape).toBe(false)
    })

    test('--scrape explicitly enables scraping', () => {
        const options = parseCliArgs(['--scrape'], {}, true)
        expect(options.scrape).toBe(true)
    })

    test('SCRAPE=false env var disables scraping', () => {
        const options = parseCliArgs([], { SCRAPE: 'false', NON_INTERACTIVE: 'true' }, true)
        expect(options.scrape).toBe(false)
    })

    test('headless is true by default and can be overridden with --no-headless or --headed', () => {
        expect(parseCliArgs([], {}, true).headless).toBe(true)
        expect(parseCliArgs(['--no-headless'], {}, true).headless).toBe(false)
        expect(parseCliArgs(['--headed'], {}, true).headless).toBe(false)
        expect(parseCliArgs([], { HEADLESS: 'false' }, true).headless).toBe(false)
    })

    test('--rematch flag sets rematch to true', () => {
        expect(parseCliArgs([], {}, true).rematch).toBe(false)
        expect(parseCliArgs(['--rematch'], {}, true).rematch).toBe(true)
        expect(parseCliArgs([], { REMATCH: 'true' }, true).rematch).toBe(true)
    })

    test('-h and --help set help to true', () => {
        expect(parseCliArgs(['-h'], {}, true).help).toBe(true)
        expect(parseCliArgs(['--help'], {}, true).help).toBe(true)
    })
})

