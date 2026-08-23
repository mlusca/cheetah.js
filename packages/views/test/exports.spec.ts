import { describe, expect, test } from 'bun:test';
import { Carno } from '@carno.js/core';
import {
    CarnoViews,
    ViewForbiddenError,
    ViewNotFoundError,
    ViewService,
    isViewEngine,
    resolveViewEngine,
    selectViewFormat,
} from '../src';
import { plainEngine } from './helpers';

describe('package exports', () => {
    test('CarnoViews returns a Carno plugin and exposes ViewService', () => {
        const plugin = CarnoViews({ engine: plainEngine(), views: '.' });

        expect(plugin).toBeInstanceOf(Carno);
        expect(typeof ViewService).toBe('function');
        expect(typeof isViewEngine).toBe('function');
        expect(typeof selectViewFormat).toBe('function');
        expect(new ViewNotFoundError('missing', ['/tmp/missing.html'])).toBeInstanceOf(ViewNotFoundError);
        expect(new ViewForbiddenError()).toBeInstanceOf(ViewForbiddenError);
    });

    test('engine is required', () => {
        expect(() => CarnoViews({} as any)).toThrow(/explicit engine/);
    });

    test('unknown official engine names are rejected', async () => {
        await expect(resolveViewEngine('nunjucks' as any)).rejects.toThrow(/Unknown view engine/);
    });
});
