/**
 * Path helpers that mirror `@carno.js/core` (`Controller` decorator + `compileController`).
 */

export function normalizeControllerPath(path: string): string {
    if (!path) {
        return '';
    }

    let normalized = path.startsWith('/') ? path : `/${path}`;

    if (normalized !== '/' && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
}

export function normalizeMethodPath(path: string): string {
    if (!path) {
        return '/';
    }

    return path.startsWith('/') ? path : `/${path}`;
}

export function normalizeRoutePath(path: string): string {
    if (!path) {
        return '/';
    }

    if (!path.startsWith('/')) {
        path = `/${path}`;
    }

    if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    return path.replace(/\/+/g, '/');
}

export function splitPathSegments(path: string): string[] {
    return normalizeRoutePath(path).split('/').filter(Boolean);
}

export function pathParamNames(path: string): string[] {
    const names: string[] = [];
    const re = /:([A-Za-z_][A-Za-z0-9_]*)/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(path))) {
        names.push(match[1]);
    }

    return names;
}

export function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

export function quoteProp(name: string): string {
    return isValidIdentifier(name) ? name : JSON.stringify(name);
}

export function controllerKey(name: string): string {
    return name.replace(/Controller$/, '');
}

export function camelCase(name: string): string {
    if (!name) {
        return name;
    }

    return name.charAt(0).toLowerCase() + name.slice(1);
}
