import fs from 'node:fs';
import path from 'node:path';

export const fixtureRoot = path.resolve(import.meta.dir, 'fixtures/app');

export const scratchRoot = path.resolve(
    'C:/Users/lucas.rodrigues_saip/AppData/Local/Temp/grok-goal-fef546bc1bf8/implementer'
);

export function scratchDir(name: string): string {
    const dir = path.join(scratchRoot, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function copyFixture(name: string): string {
    const dest = scratchDir(name);
    fs.cpSync(fixtureRoot, dest, { recursive: true });
    return dest;
}

export function findRoute(
    routes: Array<{ method: string; path: string }>,
    method: string,
    pathName: string
) {
    return routes.find((route) => route.method === method && route.path === pathName);
}
