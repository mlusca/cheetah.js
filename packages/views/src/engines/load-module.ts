function isMissingModuleError(error: unknown, packageName: string): boolean {
    const err = error as { code?: string; message?: string } | undefined;
    const message = String(err?.message ?? error ?? '');
    const code = err?.code ?? '';

    return code === 'ERR_MODULE_NOT_FOUND'
        || code === 'MODULE_NOT_FOUND'
        || message.includes(`Cannot find package '${packageName}'`)
        || message.includes(`Cannot find module '${packageName}'`)
        || message.includes(`Cannot find package "${packageName}"`)
        || message.includes(`Cannot find module "${packageName}"`);
}

export function interopDefault<T = any>(mod: any): T {
    if (mod && typeof mod === 'object' && 'default' in mod && mod.default) {
        return (mod.default.default ?? mod.default) as T;
    }

    return mod as T;
}

export function missingEngineError(packageName: string, engineName: string): Error {
    return new Error(
        `Unable to load the "${engineName}" view engine. Install it with: bun add ${packageName}`
    );
}

export function rethrowIfPresent(error: unknown, packageName: string, engineName: string): never {
    if (!isMissingModuleError(error, packageName)) {
        throw error;
    }

    throw missingEngineError(packageName, engineName);
}
