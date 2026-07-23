import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { Carno } from '@carno.js/core';
import { StaticPlugin, getMimeType } from '../src';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'public');

// Helper to create and start app
async function createApp(config: Parameters<typeof StaticPlugin.create>[0], port: number): Promise<Carno> {
    const app = new Carno({ disableStartupLog: true });
    app.use(await StaticPlugin.create(config));
    await app.listen(port);
    return app;
}

describe('StaticPlugin', () => {
    let app: Carno | null = null;
    let port = 3100;

    beforeEach(() => {
        port++; // Use different port for each test to avoid conflicts
    });

    afterEach(() => {
        app?.stop();
        app = null;
    });

    // ============================================================
    // DEVELOPMENT MODE (alwaysStatic: false)
    // ============================================================
    describe('Development Mode (alwaysStatic: false)', () => {

        describe('Basic File Serving', () => {
            it('should serve HTML file with correct content', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/index.html`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toContain('text/html');
                const text = await res.text();
                expect(text).toContain('Hello from static!');
            });

            it('should serve CSS file with correct MIME type', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/style.css`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toContain('text/css');
            });

            it('should serve JavaScript file with correct MIME type', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/script.js`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toContain('application/javascript');
            });

            it('should serve JSON file with correct MIME type', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/data.json`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toBe('application/json');
                const json = await res.json();
                expect(json).toEqual({ data: 'test' });
            });

            it('should serve plain text file with correct MIME type', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/file.txt`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toContain('text/plain');
            });

            it('should serve files from subdirectories', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/subdir/nested.css`);

                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toContain('text/css');
                expect(await res.text()).toContain('file-in-subdir');
            });
        });

        describe('Index Files', () => {
            it('should serve index.html for root path /', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/`);

                expect(res.status).toBe(200);
                expect(await res.text()).toContain('Hello from static!');
            });

            it('should serve index.html for subdirectory path', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/subdir/`);

                expect(res.status).toBe(200);
                expect(await res.text()).toContain('Subdir Index');
            });

            it('should support custom index file names', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    index: ['index.html', 'default.html']
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/`);

                expect(res.status).toBe(200);
            });
        });

        describe('404 Not Found', () => {
            it('should return 404 for non-existent file', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/does-not-exist.txt`);

                expect(res.status).toBe(404);
            });

            it('should return 404 for non-existent directory', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/nonexistent/path/`);

                expect(res.status).toBe(404);
            });
        });

        describe('Security - Path Traversal Prevention', () => {
            it('should block path traversal with ../', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);

                // URL normalization happens before request reaches server
                // So ../ is normalized to /etc/passwd which doesn't exist -> 404
                // or server detects and returns 403
                expect([403, 404]).toContain(res.status);
            });

            it('should block path traversal with encoded %2e%2e', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`);

                // Should be either 403 or 404 (depending on decoding)
                expect([403, 404]).toContain(res.status);
            });

            it('should block absolute path attempts', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                // Attempt to access absolute Windows path
                const res = await fetch(`http://127.0.0.1:${port}/C:/Windows/System32/config/sam`);

                expect([403, 404]).toContain(res.status);
            });
        });

        describe('Security - Dotfiles', () => {
            it('should block dotfiles by default', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/.hidden`);

                expect(res.status).toBe(403);
            });

            it('should allow dotfiles when dotFiles: true', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    dotFiles: true
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/.hidden`);

                expect(res.status).toBe(200);
                expect(await res.text()).toContain('secret');
            });

            it('should block .git directory access', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/.git/config`);

                expect(res.status).toBe(403);
            });

            it('should block .env file access', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/.env`);

                expect(res.status).toBe(403);
            });
        });

        describe('Extensions Whitelist', () => {
            it('should only serve whitelisted extensions', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    extensions: ['html', 'css']
                }, port);

                // HTML should work
                const htmlRes = await fetch(`http://127.0.0.1:${port}/index.html`);
                expect(htmlRes.status).toBe(200);

                // CSS should work
                const cssRes = await fetch(`http://127.0.0.1:${port}/style.css`);
                expect(cssRes.status).toBe(200);

                // JS should be blocked
                const jsRes = await fetch(`http://127.0.0.1:${port}/script.js`);
                expect(jsRes.status).toBe(403);
            });
        });

        describe('Cache-Control Headers', () => {
            it('should set default Cache-Control header', async () => {
                app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

                const res = await fetch(`http://127.0.0.1:${port}/index.html`);

                expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
            });

            it('should set custom Cache-Control header', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    cacheControl: 'public, max-age=31536000, immutable'
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/index.html`);

                expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            });

            it('should not set Cache-Control when disabled', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    cacheControl: false
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/index.html`);

                expect(res.headers.get('cache-control')).toBeNull();
            });
        });

        describe('URL Prefix', () => {
            it('should serve files under custom prefix', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    prefix: '/assets'
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/assets/index.html`);

                expect(res.status).toBe(200);
                expect(await res.text()).toContain('Hello from static!');
            });

            it('should return 404 for files without prefix', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    prefix: '/assets'
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/index.html`);

                expect(res.status).toBe(404);
            });

            it('should serve index.html when accessing prefix without trailing slash', async () => {
                app = await createApp({
                    root: FIXTURES_DIR,
                    alwaysStatic: false,
                    prefix: '/assets'
                }, port);

                const res = await fetch(`http://127.0.0.1:${port}/assets`);

                expect(res.status).toBe(200);
                expect(await res.text()).toContain('Hello from static!');
            });
        });
    });

    // ============================================================
    // SPA MODE
    // ============================================================
    describe('SPA Mode', () => {
        it('should fallback to index.html for non-existent routes', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                spa: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/some/deep/route`);

            expect(res.status).toBe(200);
            expect(await res.text()).toContain('Hello from static!');
        });

        it('should still serve existing static files normally', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                spa: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/style.css`);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/css');
        });

        it('should fallback for routes with file-like names', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                spa: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/users/profile`);

            expect(res.status).toBe(200);
            expect(await res.text()).toContain('Hello from static!');
        });
    });

    // ============================================================
    // PRODUCTION MODE (alwaysStatic: true)
    // ============================================================
    describe('Production Mode (alwaysStatic: true)', () => {
        it('should serve pre-loaded HTML file', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/index.html`);

            expect(res.status).toBe(200);
            expect(await res.text()).toContain('Hello from static!');
        });

        it('should serve pre-loaded CSS file', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/style.css`);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/css');
        });

        it('should register index route for directories', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/`);

            expect(res.status).toBe(200);
        });

        it('should respect ignorePatterns', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: true,
                dotFiles: true, // Enable dotfiles first
                ignorePatterns: ['.hidden']
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/.hidden`);

            // Should not be registered because of ignorePatterns
            expect(res.status).toBe(404);
        });

        it('should serve files from subdirectories', async () => {
            app = await createApp({
                root: FIXTURES_DIR,
                alwaysStatic: true
            }, port);

            const res = await fetch(`http://127.0.0.1:${port}/subdir/nested.css`);

            expect(res.status).toBe(200);
        });
    });

    // ============================================================
    // MIME TYPES
    // ============================================================
    describe('MIME Types', () => {
        it('should return correct MIME type for HTML', () => {
            expect(getMimeType('file.html')).toBe('text/html; charset=utf-8');
            expect(getMimeType('file.htm')).toBe('text/html; charset=utf-8');
        });

        it('should return correct MIME type for CSS', () => {
            expect(getMimeType('style.css')).toBe('text/css; charset=utf-8');
        });

        it('should return correct MIME type for JavaScript', () => {
            expect(getMimeType('script.js')).toBe('application/javascript; charset=utf-8');
            expect(getMimeType('module.mjs')).toBe('application/javascript; charset=utf-8');
        });

        it('should return correct MIME type for JSON', () => {
            expect(getMimeType('data.json')).toBe('application/json');
        });

        it('should return correct MIME type for images', () => {
            expect(getMimeType('image.png')).toBe('image/png');
            expect(getMimeType('photo.jpg')).toBe('image/jpeg');
            expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
            expect(getMimeType('icon.svg')).toBe('image/svg+xml');
            expect(getMimeType('modern.webp')).toBe('image/webp');
        });

        it('should return correct MIME type for fonts', () => {
            expect(getMimeType('font.woff')).toBe('font/woff');
            expect(getMimeType('font.woff2')).toBe('font/woff2');
            expect(getMimeType('font.ttf')).toBe('font/ttf');
        });

        it('should return octet-stream for unknown extensions', () => {
            expect(getMimeType('file.xyz')).toBe('application/octet-stream');
            expect(getMimeType('file.unknown')).toBe('application/octet-stream');
        });

        it('should handle files without extension', () => {
            expect(getMimeType('README')).toBe('application/octet-stream');
        });

        it('should be case-insensitive', () => {
            expect(getMimeType('FILE.HTML')).toBe('text/html; charset=utf-8');
            expect(getMimeType('style.CSS')).toBe('text/css; charset=utf-8');
        });
    });

    // ============================================================
    // EDGE CASES
    // ============================================================
    describe('Edge Cases', () => {
        it('should handle query strings in URL', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const res = await fetch(`http://127.0.0.1:${port}/index.html?v=123&cache=bust`);

            expect(res.status).toBe(200);
            expect(await res.text()).toContain('Hello from static!');
        });

        it('should handle URL-encoded characters', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const res = await fetch(`http://127.0.0.1:${port}/index%2Ehtml`);

            // %2E is encoded dot - should work or may stay encoded -> 404
            expect([200, 404]).toContain(res.status);
        });

        it('should handle multiple slashes in path', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const res = await fetch(`http://127.0.0.1:${port}//index.html`);

            // Should normalize and serve
            expect([200, 404]).toContain(res.status);
        });

        it('should handle trailing slashes', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const res = await fetch(`http://127.0.0.1:${port}/subdir/`);

            expect(res.status).toBe(200);
        });
    });

    // ============================================================
    // CONCURRENT REQUESTS
    // ============================================================
    describe('Concurrent Requests', () => {
        it('should handle multiple concurrent requests', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const requests = Array(10).fill(null).map(() =>
                fetch(`http://127.0.0.1:${port}/index.html`)
            );

            const responses = await Promise.all(requests);

            for (const res of responses) {
                expect(res.status).toBe(200);
            }
        });

        it('should handle concurrent requests to different files', async () => {
            app = await createApp({ root: FIXTURES_DIR, alwaysStatic: false }, port);

            const files = ['/index.html', '/style.css', '/script.js', '/data.json'];
            const requests = files.map(file =>
                fetch(`http://127.0.0.1:${port}${file}`)
            );

            const responses = await Promise.all(requests);

            for (const res of responses) {
                expect(res.status).toBe(200);
            }
        });
    });

    describe('Route Compatibility with Other Controllers', () => {
        const { Controller, Get, Post } = require('@carno.js/core');

        it('should work alongside API controllers', async () => {
            @Controller('/api')
            class ApiController {
                @Get('/users')
                getUsers() {
                    return { users: ['Alice', 'Bob'] };
                }

                @Get('/status')
                getStatus() {
                    return { status: 'ok' };
                }
            }

            app = new Carno({ disableStartupLog: true });
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false
            }));
            app.controllers(ApiController);
            await app.listen(port);

            // API routes should work
            const apiRes = await fetch(`http://127.0.0.1:${port}/api/users`);
            expect(apiRes.status).toBe(200);
            expect(await apiRes.json()).toEqual({ users: ['Alice', 'Bob'] });

            // Static files should still work
            const staticRes = await fetch(`http://127.0.0.1:${port}/index.html`);
            expect(staticRes.status).toBe(200);
            expect(await staticRes.text()).toContain('Hello from static!');
        });

        it('should not interfere with root API routes', async () => {
            @Controller()
            class RootController {
                @Get('/health')
                health() {
                    return { healthy: true };
                }

                @Post('/webhook')
                webhook() {
                    return { received: true };
                }
            }

            app = new Carno({ disableStartupLog: true });
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false
            }));
            app.controllers(RootController);
            await app.listen(port);

            // Root API routes should work
            const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
            expect(healthRes.status).toBe(200);
            expect(await healthRes.json()).toEqual({ healthy: true });

            // POST should work
            const webhookRes = await fetch(`http://127.0.0.1:${port}/webhook`, {
                method: 'POST'
            });
            expect(webhookRes.status).toBe(200);

            // Static files should still work
            const cssRes = await fetch(`http://127.0.0.1:${port}/style.css`);
            expect(cssRes.status).toBe(200);
        });

        it('should work with prefix to avoid conflicts', async () => {
            @Controller()
            class AppController {
                @Get('/')
                home() {
                    return 'Home Page';
                }

                @Get('/about')
                about() {
                    return 'About Page';
                }
            }

            app = new Carno({ disableStartupLog: true });
            // Static files under /static prefix
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                prefix: '/static'
            }));
            app.controllers(AppController);
            await app.listen(port);

            // App routes should work at root
            const homeRes = await fetch(`http://127.0.0.1:${port}/`);
            expect(homeRes.status).toBe(200);
            expect(await homeRes.text()).toBe('Home Page');

            const aboutRes = await fetch(`http://127.0.0.1:${port}/about`);
            expect(aboutRes.status).toBe(200);

            // Static files should work under /static prefix
            const staticRes = await fetch(`http://127.0.0.1:${port}/static/index.html`);
            expect(staticRes.status).toBe(200);
            expect(await staticRes.text()).toContain('Hello from static!');
        });

        it('should allow API to take precedence when registered after static', async () => {
            @Controller()
            class OverrideController {
                @Get('/data.json')
                getData() {
                    return { overridden: true };
                }
            }

            app = new Carno({ disableStartupLog: true });
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false
            }));
            app.controllers(OverrideController);
            await app.listen(port);

            // Controller route should take precedence
            const res = await fetch(`http://127.0.0.1:${port}/data.json`);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ overridden: true });
        });

        // Multiple plugins supported via route closure
        it('should work with multiple static plugins with different prefixes', async () => {
            app = new Carno({ disableStartupLog: true });

            // First static plugin for /assets
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                prefix: '/assets'
            }));

            // Second static plugin for /public
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: false,
                prefix: '/public'
            }));

            await app.listen(port);

            // Both prefixes should work
            const assetsRes = await fetch(`http://127.0.0.1:${port}/assets/index.html`);
            expect(assetsRes.status).toBe(200);

            const publicRes = await fetch(`http://127.0.0.1:${port}/public/style.css`);
            expect(publicRes.status).toBe(200);
        });

        it('should work in production mode with API controllers', async () => {
            @Controller('/api')
            class ProdApiController {
                @Get('/data')
                getData() {
                    return { mode: 'production' };
                }
            }

            app = new Carno({ disableStartupLog: true });
            app.use(await StaticPlugin.create({
                root: FIXTURES_DIR,
                alwaysStatic: true // Production mode
            }));
            app.controllers(ProdApiController);
            await app.listen(port);

            // API should work
            const apiRes = await fetch(`http://127.0.0.1:${port}/api/data`);
            expect(apiRes.status).toBe(200);
            expect(await apiRes.json()).toEqual({ mode: 'production' });

            // Static files should work (pre-loaded)
            const staticRes = await fetch(`http://127.0.0.1:${port}/index.html`);
            expect(staticRes.status).toBe(200);
        });
    });
});
