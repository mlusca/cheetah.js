import type { ViewFormat } from './types';

interface AcceptRange {
    type: string;
    q: number;
}

interface FormatMatch {
    q: number;
    spec: number;
}

const HTML_EXACT = new Set(['text/html', 'application/xhtml+xml']);
const JSON_EXACT = new Set(['application/json', 'text/json']);

function clampQuality(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return value > 1 ? 1 : value;
}

function parseAccept(header: string): AcceptRange[] {
    const ranges: AcceptRange[] = [];

    for (const part of header.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        const [media, ...params] = trimmed.split(';');
        const type = (media ?? '').trim().toLowerCase();
        if (!type) continue;

        let q = 1;

        for (const param of params) {
            const [rawKey, rawValue] = param.split('=').map(value => value.trim());
            if ((rawKey ?? '').toLowerCase() !== 'q' || !rawValue) continue;
            q = clampQuality(Number(rawValue));
        }

        ranges.push({ type, q });
    }

    return ranges;
}

function specificity(type: string, exact: Set<string>, typeWildcard: string): number {
    if (exact.has(type)) return 3;
    if (type === typeWildcard) return 2;
    if (type === '*/*') return 1;
    return 0;
}

/**
 * Most specific matching range for a format determines its q (RFC 9110).
 * Exact type beats a type wildcard, which beats the catch-all wildcard.
 */
function matchFormat(ranges: AcceptRange[], exact: Set<string>, typeWildcard: string): FormatMatch | null {
    let best: FormatMatch | null = null;

    for (const range of ranges) {
        const spec = specificity(range.type, exact, typeWildcard);
        if (spec === 0) continue;

        if (!best || spec > best.spec || (spec === best.spec && range.q > best.q)) {
            best = { q: range.q, spec };
        }
    }

    return best;
}

function isAcceptable(match: FormatMatch | null): match is FormatMatch {
    return match !== null && match.q > 0;
}

function isForbidden(match: FormatMatch | null): boolean {
    return match !== null && match.q <= 0;
}

/**
 * Choose HTML vs JSON from an Accept header.
 *
 * Each format uses its most specific matching range. `q=0` makes that format
 * unacceptable and it is never selected, including as `defaultFormat`. Among
 * acceptable formats, higher q wins; equal q prefers the more specific match;
 * remaining ties, missing headers, and unmatched types use `defaultFormat`.
 *
 * Returns `null` when both supported formats are explicitly refused so the
 * caller can respond with 406 instead of applying the default.
 */
export function selectViewFormat(
    accept: string | null | undefined,
    defaultFormat: ViewFormat = 'html'
): ViewFormat | null {
    if (!accept || !accept.trim()) {
        return defaultFormat;
    }

    const ranges = parseAccept(accept);
    const html = matchFormat(ranges, HTML_EXACT, 'text/*');
    const json = matchFormat(ranges, JSON_EXACT, 'application/*');
    const htmlOk = isAcceptable(html);
    const jsonOk = isAcceptable(json);

    if (htmlOk && jsonOk) {
        if (html.q !== json.q) {
            return html.q > json.q ? 'html' : 'json';
        }

        if (html.spec !== json.spec) {
            return html.spec > json.spec ? 'html' : 'json';
        }

        return defaultFormat;
    }

    if (htmlOk) return 'html';
    if (jsonOk) return 'json';

    if (isForbidden(html) && isForbidden(json)) {
        return null;
    }

    if (isForbidden(html)) {
        return 'json';
    }

    if (isForbidden(json)) {
        return 'html';
    }

    return defaultFormat;
}
