import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context, NotFoundException } from '@carno.js/core';
import {
    ViewForbiddenError,
    ViewNotFoundError,
    ViewService,
    resolveViewsRoot,
} from '../src';
import { makeTempViews, plainEngine, writeView } from './helpers';

function htmlCtx(accept?: string): Context {
    const headers = accept ? { Accept: accept } : undefined;
    return new Context(new Request('http://127.0.0.1/page', { headers }));
}

describe('ViewService', () => {
    test('resolveViewsRoot defaults to ./views under cwd', () => {
        expect(resolveViewsRoot()).toBe(path.resolve(process.cwd(), './views'));
        expect(resolveViewsRoot('templates')).toBe(path.resolve(process.cwd(), 'templates'));
    });

    test('custom engines without compile receive the source string', async () => {
        const views = await makeTempViews('no-compile', {
            'hello.html': 'Hi {{name}}',
        });
        const service = new ViewService({
            engine: {
                name: 'plain',
                extensions: ['.html'],
                render(template, data) {
                    expect(typeof template).toBe('string');
                    return String(template).replace('{{name}}', String(data.name ?? ''));
                },
            },
            views,
            cache: false,
        });

        expect(await (await service.html('hello', { name: 'Ada' })).text()).toBe('Hi Ada');
    });

    test('html() renders through a custom engine', async () => {
        const views = await makeTempViews('custom', {
            'hello.html': '<p>Hello {{name}}</p>',
        });
        const service = new ViewService({ engine: plainEngine(), views, cache: false });
        const response = await service.html('hello', { name: 'Ada' });

        expect(response.headers.get('content-type')).toBe('text/html');
        expect(await response.text()).toBe('<p>Hello Ada</p>');
    });

    test('cache keeps the compiled template when the file changes', async () => {
        const compiles = { count: 0 };
        const views = await makeTempViews('cache-on', {
            'hello.html': 'Hello {{name}}',
        });
        const service = new ViewService({ engine: plainEngine(compiles), views, cache: true });

        const first = await service.html('hello', { name: 'Ada' });
        expect(await first.text()).toBe('Hello Ada');

        await writeView(views, 'hello.html', 'Changed {{name}}');
        const second = await service.html('hello', { name: 'Ada' });

        expect(await second.text()).toBe('Hello Ada');
        expect(compiles.count).toBe(1);
    });

    test('cache off recompiles after the file changes', async () => {
        const compiles = { count: 0 };
        const views = await makeTempViews('cache-off', {
            'hello.html': 'Hello {{name}}',
        });
        const service = new ViewService({ engine: plainEngine(compiles), views, cache: false });

        expect(await (await service.html('hello', { name: 'Ada' })).text()).toBe('Hello Ada');
        await writeView(views, 'hello.html', 'Changed {{name}}');
        expect(await (await service.html('hello', { name: 'Ada' })).text()).toBe('Changed Ada');
        expect(compiles.count).toBe(2);
    });

    test('rejects path traversal', async () => {
        const views = await makeTempViews('safe', {
            'hello.html': 'ok',
        });
        const service = new ViewService({ engine: plainEngine(), views, cache: false });

        await expect(service.html('../secret')).rejects.toBeInstanceOf(ViewForbiddenError);
        await expect(service.html('..\\secret')).rejects.toBeInstanceOf(ViewForbiddenError);
        await expect(service.html('/etc/passwd')).rejects.toBeInstanceOf(ViewForbiddenError);
        await expect(service.html('foo/../../etc/passwd')).rejects.toBeInstanceOf(ViewForbiddenError);
    });

    test('rejects a symlink that escapes the views root', async () => {
        const views = await makeTempViews('symlink', {
            'hello.html': 'ok',
        });
        const outside = path.join(os.tmpdir(), `carno-views-outside-${Date.now()}.html`);
        await fs.writeFile(outside, 'escaped', 'utf8');
        const link = path.join(views, 'escape.html');

        try {
            await fs.symlink(outside, link);
        } catch {
            return;
        }

        const service = new ViewService({ engine: plainEngine(), views, cache: false });
        await expect(service.html('escape')).rejects.toBeInstanceOf(ViewForbiddenError);
    });

    test('missing templates throw ViewNotFoundError with tried paths and no absolute path in the message', async () => {
        const views = await makeTempViews('missing', {
            'hello.html': 'ok',
        });
        const service = new ViewService({ engine: plainEngine(), views, cache: false });

        try {
            await service.html('nope');
            throw new Error('expected ViewNotFoundError');
        } catch (error) {
            expect(error).toBeInstanceOf(ViewNotFoundError);
            expect(error).toBeInstanceOf(NotFoundException);
            const notFound = error as ViewNotFoundError;
            expect(notFound.tried.length).toBeGreaterThan(0);
            expect(notFound.tried.some(candidate => candidate.includes('nope'))).toBe(true);
            expect(notFound.message).toBe('View "nope" was not found');
            expect(notFound.message.includes(views)).toBe(false);
            expect(notFound.statusCode).toBe(404);
        }
    });

    test('registerHelper is available after bootstrap helpers', async () => {
        const views = await makeTempViews('helpers', {
            'hello.html': '{{hello}} {{name}}',
        });
        const engine: ReturnType<typeof plainEngine> = {
            name: 'helpers',
            extensions: ['.html'],
            render(template, data, options) {
                let html = String(template);
                for (const [name, helper] of Object.entries(options?.helpers ?? {})) {
                    html = html.replace(`{{${name}}}`, String(helper(data)));
                }
                return html.replace('{{name}}', String(data.name ?? ''));
            },
        };

        const service = new ViewService({
            engine,
            views,
            cache: false,
            helpers: {
                hello: () => 'Hi',
            },
        });

        expect(await (await service.html('hello', { name: 'Ada' })).text()).toBe('Hi Ada');
        service.registerHelper('hello', () => 'Hey');
        expect(await (await service.html('hello', { name: 'Ada' })).text()).toBe('Hey Ada');
    });

    test('respond() negotiates HTML, JSON, */* and a configurable default', async () => {
        const views = await makeTempViews('negotiate', {
            'hello.html': '<p>{{name}}</p>',
        });
        const htmlDefault = new ViewService({ engine: plainEngine(), views, cache: false });
        const jsonDefault = new ViewService({
            engine: plainEngine(),
            views,
            cache: false,
            negotiate: { default: 'json' },
        });

        const html = await htmlDefault.respond(htmlCtx('text/html'), 'hello', { name: 'Ada' });
        expect(html.headers.get('content-type')).toContain('text/html');
        expect(html.headers.get('vary')).toBe('Accept');
        expect(await html.text()).toBe('<p>Ada</p>');

        const json = await htmlDefault.respond(htmlCtx('application/json'), 'missing', { name: 'Ada' });
        expect(json.headers.get('content-type')).toContain('application/json');
        expect(json.headers.get('vary')).toBe('Accept');
        expect(await json.json()).toEqual({ name: 'Ada' });

        const star = await htmlDefault.respond(htmlCtx('*/*'), 'hello', { name: 'Ada' });
        expect(await star.text()).toBe('<p>Ada</p>');

        const missing = await htmlDefault.respond(htmlCtx(), 'hello', { name: 'Ada' });
        expect(await missing.text()).toBe('<p>Ada</p>');

        const defaultJson = await jsonDefault.respond(htmlCtx('*/*'), 'hello', { name: 'Ada' });
        expect(await defaultJson.json()).toEqual({ name: 'Ada' });

        const htmlForbidden = await htmlDefault.respond(
            htmlCtx('text/html;q=0, */*;q=1'),
            'hello',
            { name: 'Ada' }
        );
        expect(htmlForbidden.headers.get('content-type')).toContain('application/json');
        expect(await htmlForbidden.json()).toEqual({ name: 'Ada' });

        const jsonForbidden = await jsonDefault.respond(
            htmlCtx('application/json;q=0'),
            'hello',
            { name: 'Ada' }
        );
        expect(jsonForbidden.headers.get('content-type')).toContain('text/html');
        expect(await jsonForbidden.text()).toBe('<p>Ada</p>');

        const bothForbidden = await htmlDefault.respond(
            htmlCtx('text/html;q=0, application/json;q=0'),
            'missing',
            { name: 'Ada' }
        );
        expect(bothForbidden.status).toBe(406);
        expect(bothForbidden.headers.get('vary')).toBe('Accept');
        expect(bothForbidden.headers.get('content-type')).toContain('application/json');
        expect(await bothForbidden.json()).toEqual({ statusCode: 406, message: 'Not Acceptable' });
    });
});
