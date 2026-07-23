import { describe, expect, it, afterEach } from 'bun:test';
import { Carno } from '@carno.js/core';
import { StaticPlugin } from './src';
import * as path from 'path';

console.log('Test Dir:', import.meta.dir);
const FIXTURES_DIR = path.join(import.meta.dir, 'test', 'fixtures', 'public');
console.log('Fixtures Dir:', FIXTURES_DIR);
const hasIndex = await Bun.file(path.join(FIXTURES_DIR, 'index.html')).exists();
console.log('Has Index:', hasIndex);

describe('StaticPlugin Prefix Handling', () => {
    let app: Carno;
    let port = 4002;

    afterEach(async () => {
        if (app) await app.stop();
        port++;
    });

    it('should match /prefix/ (trailing slash)', async () => {
        app = new Carno({ disableStartupLog: true });
        app.use(await StaticPlugin.create({
            root: FIXTURES_DIR,
            prefix: '/public',
            alwaysStatic: false
        }));
        await app.listen(port);

        const res = await fetch(`http://127.0.0.1:${port}/public/`);
        expect(res.status).toBe(200); // Should serve index.html
    });

    it('should match /prefix (no trailing slash)', async () => {
        app = new Carno({ disableStartupLog: true });
        app.use(await StaticPlugin.create({
            root: FIXTURES_DIR,
            prefix: '/public',
            alwaysStatic: false
        }));
        await app.listen(port);

        const res = await fetch(`http://127.0.0.1:${port}/public`);

        // This is the suspected failure case if route is /public/*
        expect(res.status).toBe(200);
    });

    it('should match /prefix/file.txt', async () => {
        app = new Carno({ disableStartupLog: true });
        app.use(await StaticPlugin.create({
            root: FIXTURES_DIR,
            prefix: '/public',
            alwaysStatic: false
        }));
        await app.listen(port);

        const res = await fetch(`http://127.0.0.1:${port}/public/index.html`);
        expect(res.status).toBe(200);
    });
});
