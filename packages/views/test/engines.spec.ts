import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ViewForbiddenError, ViewService } from '../src';
import { FIXTURES, makeTempViews, writeView } from './helpers';

async function writeOutsideEjs(contents = 'SECRET'): Promise<string> {
    const file = path.join(
        os.tmpdir(),
        `carno-views-outside-${Date.now()}-${Math.random().toString(16).slice(2)}.ejs`
    );
    await fs.writeFile(file, contents, 'utf8');
    return file;
}

async function writeOutsidePug(contents = 'p SECRET'): Promise<string> {
    const file = path.join(
        os.tmpdir(),
        `carno-views-outside-${Date.now()}-${Math.random().toString(16).slice(2)}.pug`
    );
    await fs.writeFile(file, contents, 'utf8');
    return file;
}

function posixRelative(from: string, to: string): string {
    return path.relative(from, to).replace(/\\/g, '/');
}

describe('official engines', () => {
    test('Handlebars cache off unregisters a partial removed from disk', async () => {
        const views = await makeTempViews('hbs-partial-remove', {
            'hello.hbs': 'Hello {{> who}}',
            'partials/who.hbs': 'Ada',
        });
        const service = new ViewService({
            engine: 'handlebars',
            views,
            cache: false,
            partials: 'partials',
        });

        expect(await (await service.html('hello')).text()).toBe('Hello Ada');

        await fs.unlink(path.join(views, 'partials/who.hbs'));

        await expect(service.html('hello')).rejects.toThrow(/partial/i);

        await writeView(views, 'partials/who.hbs', 'Grace');
        expect(await (await service.html('hello')).text()).toBe('Hello Grace');
    });

    test('Handlebars helper, layout and partial', async () => {
        const service = new ViewService({
            engine: 'handlebars',
            views: path.join(FIXTURES, 'handlebars'),
            cache: false,
            layout: 'layouts/main',
            partials: 'partials',
            helpers: {
                shout: (value: string) => String(value).toUpperCase(),
            },
        });

        const html = await (await service.html('hello', { name: 'Ada', loud: true })).text();
        expect(html).toContain('<html>');
        expect(html).toContain('<p>Hello Ada');
        expect(html).toContain('ADA');
        expect(html).not.toContain('{{{body}}}');
    });

    test('EJS include uses filename and views', async () => {
        const service = new ViewService({
            engine: 'ejs',
            views: path.join(FIXTURES, 'ejs'),
            cache: false,
            layout: 'layouts/main',
        });

        const html = await (await service.html('hello', { name: 'Ada' })).text();
        expect(html).toContain('<html>');
        expect(html).toContain('Hello Ada');
    });

    test('EJS cache on keeps included partials after disk change', async () => {
        const views = await makeTempViews('ejs-cache-on', {
            'hello.ejs': '<p>Hello <%- include("who") %></p>',
            'who.ejs': 'Ada',
        });
        const service = new ViewService({ engine: 'ejs', views, cache: true });

        expect(await (await service.html('hello')).text()).toBe('<p>Hello Ada</p>');
        await writeView(views, 'who.ejs', 'Grace');
        expect(await (await service.html('hello')).text()).toBe('<p>Hello Ada</p>');
    });

    test('EJS cache off re-reads included partials after disk change', async () => {
        const views = await makeTempViews('ejs-cache-off', {
            'hello.ejs': '<p>Hello <%- include("who") %></p>',
            'who.ejs': 'Ada',
        });
        const service = new ViewService({ engine: 'ejs', views, cache: false });

        expect(await (await service.html('hello')).text()).toBe('<p>Hello Ada</p>');
        await writeView(views, 'who.ejs', 'Grace');
        expect(await (await service.html('hello')).text()).toBe('<p>Hello Grace</p>');
    });

    test('EJS include from a nested template can use .. while staying inside views', async () => {
        const views = await makeTempViews('ejs-nested-include', {
            'pages/hello.ejs': '<p><%- include("../who") %></p>',
            'who.ejs': 'Ada',
        });
        const service = new ViewService({ engine: 'ejs', views, cache: false });

        expect(await (await service.html('pages/hello')).text()).toBe('<p>Ada</p>');
    });

    test('EJS include rejects a relative path that escapes the views root', async () => {
        const views = await makeTempViews('ejs-rel-escape', {
            'hello.ejs': '<%- include(partial) %>',
        });
        const secret = await writeOutsideEjs();
        const relative = posixRelative(views, secret);
        const service = new ViewService({ engine: 'ejs', views, cache: false });

        expect(relative.startsWith('..')).toBe(true);

        try {
            await service.html('hello', { partial: relative });
            throw new Error('expected ViewForbiddenError');
        } catch (error) {
            expect(error).toBeInstanceOf(ViewForbiddenError);
            const message = (error as Error).message;
            expect(message).toBe('View path is not allowed');
            expect(message.includes(secret)).toBe(false);
            expect(message.includes('SECRET')).toBe(false);
        }
    });

    test('EJS include rejects an absolute path outside the views root', async () => {
        const views = await makeTempViews('ejs-abs-escape', {
            'hello.ejs': '<%- include(partial) %>',
        });
        const secret = await writeOutsideEjs();
        const service = new ViewService({ engine: 'ejs', views, cache: false });

        await expect(service.html('hello', { partial: secret })).rejects.toBeInstanceOf(ViewForbiddenError);
        await expect(service.html('hello', { partial: '/etc/passwd' })).rejects.toBeInstanceOf(ViewForbiddenError);
        await expect(service.html('hello', { partial: 'C:\\Windows\\win.ini' })).rejects.toBeInstanceOf(ViewForbiddenError);
    });

    test('EJS include rejects a symlink that escapes the views root', async () => {
        const views = await makeTempViews('ejs-symlink-escape', {
            'hello.ejs': '<%- include("escape") %>',
        });
        const secret = await writeOutsideEjs();
        const link = path.join(views, 'escape.ejs');

        try {
            await fs.symlink(secret, link);
        } catch {
            return;
        }

        const service = new ViewService({ engine: 'ejs', views, cache: false });

        try {
            await service.html('hello');
            throw new Error('expected ViewForbiddenError');
        } catch (error) {
            expect(error).toBeInstanceOf(ViewForbiddenError);
            expect((error as Error).message).toBe('View path is not allowed');
            expect((error as Error).message.includes(secret)).toBe(false);
        }
    });

    test('Pug extends and include use basedir', async () => {
        const service = new ViewService({
            engine: 'pug',
            views: path.join(FIXTURES, 'pug'),
            cache: false,
        });

        const html = await (await service.html('hello', { name: 'Ada' })).text();
        expect(html).toContain('<p>Hello Ada</p>');
        expect(html).toContain('<span>Ada</span>');
    });

    test('Pug layout option wraps with != body', async () => {
        const service = new ViewService({
            engine: 'pug',
            views: path.join(FIXTURES, 'pug'),
            cache: false,
            layout: 'layouts/main',
        });

        const html = await (await service.html('wrap', { name: 'Ada' })).text();
        expect(html).toContain('<p>Wrapped</p>');
        expect(html).toContain('<html>');
        expect(html).toContain('<body>');
    });

    test('Pug include from a nested template can use .. while staying inside views', async () => {
        const views = await makeTempViews('pug-nested-include', {
            'pages/hello.pug': 'p\n  include ../who.pug',
            'who.pug': '| Ada',
        });
        const service = new ViewService({ engine: 'pug', views, cache: false });

        expect(await (await service.html('pages/hello')).text()).toBe('<p>Ada</p>');
    });

    test('Pug basedir include stays inside views', async () => {
        const views = await makeTempViews('pug-basedir-include', {
            'hello.pug': 'p\n  include /partials/who.pug',
            'partials/who.pug': '| Ada',
        });
        const service = new ViewService({ engine: 'pug', views, cache: false });

        expect(await (await service.html('hello')).text()).toBe('<p>Ada</p>');
    });

    test('Pug include rejects a relative path that escapes the views root', async () => {
        const views = await makeTempViews('pug-rel-escape', {
            'hello.pug': 'p ok',
        });
        const secret = await writeOutsidePug();
        const relative = posixRelative(views, secret);
        await writeView(views, 'hello.pug', `include ${relative}`);
        const service = new ViewService({ engine: 'pug', views, cache: false });

        expect(relative.startsWith('..')).toBe(true);

        try {
            await service.html('hello');
            throw new Error('expected ViewForbiddenError');
        } catch (error) {
            expect(error).toBeInstanceOf(ViewForbiddenError);
            const message = (error as Error).message;
            expect(message).toBe('View path is not allowed');
            expect(message.includes(secret)).toBe(false);
            expect(message.includes('SECRET')).toBe(false);
        }
    });

    test('Pug extends rejects a relative path that escapes the views root', async () => {
        const views = await makeTempViews('pug-extends-escape', {
            'hello.pug': 'p ok',
        });
        const secret = await writeOutsidePug('html\n  body\n    block content');
        const relative = posixRelative(views, secret);
        await writeView(views, 'hello.pug', `extends ${relative}\nblock content\n  p leaked`);
        const service = new ViewService({ engine: 'pug', views, cache: false });

        await expect(service.html('hello')).rejects.toBeInstanceOf(ViewForbiddenError);
    });

    test('Pug basedir include rejects a path outside the views root', async () => {
        const views = await makeTempViews('pug-abs-escape', {
            'hello.pug': 'p ok',
        });
        const secret = await writeOutsidePug();
        const service = new ViewService({ engine: 'pug', views, cache: false });

        // Pug treats a leading slash as basedir-relative, so use a parent
        // segment to exercise an escape from the configured views root on
        // both POSIX and Windows.
        const outsideBasedirPath = `/../${path.basename(secret)}`;
        await writeView(views, 'hello.pug', `include ${outsideBasedirPath}`);
        await expect(service.html('hello')).rejects.toBeInstanceOf(ViewForbiddenError);

        await writeView(views, 'hello.pug', 'include C:/Windows/win.ini');
        await expect(service.html('hello')).rejects.toBeInstanceOf(ViewForbiddenError);
    });

    test('Pug include rejects a symlink that escapes the views root', async () => {
        const views = await makeTempViews('pug-symlink-escape', {
            'hello.pug': 'include escape',
        });
        const secret = await writeOutsidePug();
        const link = path.join(views, 'escape.pug');

        try {
            await fs.symlink(secret, link);
        } catch {
            return;
        }

        const service = new ViewService({ engine: 'pug', views, cache: false });

        try {
            await service.html('hello');
            throw new Error('expected ViewForbiddenError');
        } catch (error) {
            expect(error).toBeInstanceOf(ViewForbiddenError);
            expect((error as Error).message).toBe('View path is not allowed');
            expect((error as Error).message.includes(secret)).toBe(false);
        }
    });
});
