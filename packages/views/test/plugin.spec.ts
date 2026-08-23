import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context, Controller, Ctx, Get, withTestApp } from '@carno.js/core';
import { CarnoViews, ViewService } from '../src';
import { FIXTURES, makeTempViews, plainEngine } from './helpers';

describe('CarnoViews plugin', () => {
    test('injects ViewService into a controller through withTestApp', async () => {
        const views = await makeTempViews('http', {
            'hello.html': '<h1>{{name}}</h1>',
        });

        @Controller('/pages')
        class PagesController {
            constructor(private views: ViewService) {}

            @Get('/hello')
            async hello(@Ctx() ctx: Context) {
                return this.views.respond(ctx, 'hello', { name: 'Ada' });
            }

            @Get('/about')
            async about() {
                return this.views.html('hello', { name: 'About' });
            }

            @Get('/missing')
            async missing() {
                return this.views.html('nope');
            }

            @Get('/evil')
            async evil() {
                return this.views.html('../secret');
            }
        }

        await withTestApp(async harness => {
            expect(harness.resolve(ViewService)).toBeInstanceOf(ViewService);

            const html = await harness.get('/pages/hello', { headers: { Accept: 'text/html' } });
            expect(html.status).toBe(200);
            expect(html.headers.get('content-type')).toContain('text/html');
            expect(html.headers.get('vary')).toBe('Accept');
            expect(await html.text()).toBe('<h1>Ada</h1>');

            const json = await harness.get('/pages/hello', { headers: { Accept: 'application/json' } });
            expect(json.status).toBe(200);
            expect(json.headers.get('content-type')).toContain('application/json');
            expect(await json.json()).toEqual({ name: 'Ada' });

            const notAcceptable = await harness.get('/pages/hello', {
                headers: { Accept: 'text/html;q=0, application/json;q=0' },
            });
            expect(notAcceptable.status).toBe(406);
            expect(notAcceptable.headers.get('vary')).toBe('Accept');
            const notAcceptableBody = await notAcceptable.json() as { statusCode: number; message: string };
            expect(notAcceptableBody).toEqual({ statusCode: 406, message: 'Not Acceptable' });

            const about = await harness.get('/pages/about');
            expect(about.status).toBe(200);
            expect(await about.text()).toBe('<h1>About</h1>');

            const missing = await harness.get('/pages/missing');
            expect(missing.status).toBe(404);
            const body = await missing.json() as { statusCode: number; message: string };
            expect(body.statusCode).toBe(404);
            expect(body.message).toBe('View "nope" was not found');
            expect(JSON.stringify(body).includes(views)).toBe(false);

            const evil = await harness.get('/pages/evil');
            expect(evil.status).toBe(403);
        }, {
            controllers: [PagesController],
            plugins: [CarnoViews({ engine: plainEngine(), views, cache: false })],
            listen: true,
        });
    });

    test('official handlebars engine works through the plugin', async () => {
        @Controller('/hb')
        class HandlebarsController {
            constructor(private views: ViewService) {}

            @Get()
            async index() {
                return this.views.html('hello', { name: 'Ada', loud: true });
            }
        }

        await withTestApp(async harness => {
            const response = await harness.get('/hb');
            expect(response.status).toBe(200);
            const html = await response.text();
            expect(html).toContain('<p>Hello Ada');
            expect(html).toContain('ADA');
        }, {
            controllers: [HandlebarsController],
            plugins: [CarnoViews({
                engine: 'handlebars',
                views: path.join(FIXTURES, 'handlebars'),
                cache: false,
                layout: 'layouts/main',
                partials: 'partials',
                helpers: { shout: (value: string) => String(value).toUpperCase() },
            })],
            listen: true,
        });
    });

    test('EJS include that escapes the views root is HTTP 403 without leaking paths', async () => {
        const views = await makeTempViews('http-ejs-escape', {
            'hello.ejs': '<%- include(partial) %>',
        });
        const secret = path.join(os.tmpdir(), `carno-views-http-secret-${Date.now()}.ejs`);
        await fs.writeFile(secret, 'SECRET', 'utf8');
        const relative = path.relative(views, secret).replace(/\\/g, '/');

        @Controller('/pages')
        class PagesController {
            constructor(private views: ViewService) {}

            @Get('/escape')
            async escape() {
                return this.views.html('hello', { partial: relative });
            }
        }

        await withTestApp(async harness => {
            const response = await harness.get('/pages/escape');
            expect(response.status).toBe(403);
            const body = await response.json() as { statusCode: number; message: string };
            expect(body.statusCode).toBe(403);
            expect(body.message).toBe('View path is not allowed');
            expect(JSON.stringify(body).includes(secret)).toBe(false);
            expect(JSON.stringify(body).includes('SECRET')).toBe(false);
        }, {
            controllers: [PagesController],
            plugins: [CarnoViews({ engine: 'ejs', views, cache: false })],
            listen: true,
        });
    });

    test('Pug include that escapes the views root is HTTP 403 without leaking paths', async () => {
        const views = await makeTempViews('http-pug-escape', {
            'hello.pug': 'p ok',
        });
        const secret = path.join(os.tmpdir(), `carno-views-http-secret-${Date.now()}.pug`);
        await fs.writeFile(secret, 'p SECRET', 'utf8');
        const relative = path.relative(views, secret).replace(/\\/g, '/');
        await fs.writeFile(path.join(views, 'hello.pug'), `include ${relative}`, 'utf8');

        @Controller('/pages')
        class PagesController {
            constructor(private views: ViewService) {}

            @Get('/escape')
            async escape() {
                return this.views.html('hello');
            }
        }

        await withTestApp(async harness => {
            const response = await harness.get('/pages/escape');
            expect(response.status).toBe(403);
            const body = await response.json() as { statusCode: number; message: string };
            expect(body.statusCode).toBe(403);
            expect(body.message).toBe('View path is not allowed');
            expect(JSON.stringify(body).includes(secret)).toBe(false);
            expect(JSON.stringify(body).includes('SECRET')).toBe(false);
            expect(JSON.stringify(body).includes(views)).toBe(false);
        }, {
            controllers: [PagesController],
            plugins: [CarnoViews({ engine: 'pug', views, cache: false })],
            listen: true,
        });
    });
});
