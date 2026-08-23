import { describe, expect, test } from 'bun:test';
import { selectViewFormat } from '../src';

describe('selectViewFormat', () => {
    test('missing Accept uses the configured default', () => {
        expect(selectViewFormat(null)).toBe('html');
        expect(selectViewFormat('')).toBe('html');
        expect(selectViewFormat(null, 'json')).toBe('json');
    });

    test('explicit html and json media types', () => {
        expect(selectViewFormat('text/html')).toBe('html');
        expect(selectViewFormat('application/json')).toBe('json');
        expect(selectViewFormat('text/html, application/json;q=0.9')).toBe('html');
        expect(selectViewFormat('application/json, text/html;q=0.8')).toBe('json');
    });

    test('type wildcards match the corresponding format', () => {
        expect(selectViewFormat('text/*')).toBe('html');
        expect(selectViewFormat('application/*')).toBe('json');
        expect(selectViewFormat('application/*, text/html;q=0.8')).toBe('json');
        expect(selectViewFormat('text/*, application/json;q=0.8')).toBe('html');
    });

    test('*/* unmatched types and ties fall back to default', () => {
        expect(selectViewFormat('*/*')).toBe('html');
        expect(selectViewFormat('*/*', 'json')).toBe('json');
        expect(selectViewFormat('text/plain')).toBe('html');
        expect(selectViewFormat('text/html;q=0.5, application/json;q=0.5')).toBe('html');
        expect(selectViewFormat('text/html;q=0.5, application/json;q=0.5', 'json')).toBe('json');
    });

    test('equal q prefers the more specific media type over a wildcard', () => {
        expect(selectViewFormat('text/html, */*', 'json')).toBe('html');
        expect(selectViewFormat('application/json, */*', 'html')).toBe('json');
        expect(selectViewFormat('text/html;q=0.9, */*;q=0.9', 'json')).toBe('html');
    });

    test('q=0 forbids a format even when it is the default or covered by */*', () => {
        expect(selectViewFormat('text/html;q=0, */*;q=1')).toBe('json');
        expect(selectViewFormat('text/html;q=0, */*;q=1', 'html')).toBe('json');
        expect(selectViewFormat('application/json;q=0', 'json')).toBe('html');
        expect(selectViewFormat('application/json;q=0')).toBe('html');
        expect(selectViewFormat('text/html;q=0')).toBe('json');
        expect(selectViewFormat('text/html;q=0', 'html')).toBe('json');
        expect(selectViewFormat('application/json;q=0, */*;q=1', 'json')).toBe('html');
    });

    test('returns null when both HTML and JSON are explicitly refused', () => {
        expect(selectViewFormat('text/html;q=0, application/json;q=0')).toBeNull();
        expect(selectViewFormat('text/html;q=0, application/json;q=0', 'json')).toBeNull();
        expect(selectViewFormat('text/html;q=0, application/json;q=0, */*;q=1')).toBeNull();
        expect(selectViewFormat('text/*;q=0, application/*;q=0')).toBeNull();
        expect(selectViewFormat('*/*;q=0')).toBeNull();
        expect(selectViewFormat('*/*;q=0', 'json')).toBeNull();
    });
});
