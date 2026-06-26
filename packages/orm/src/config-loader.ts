import * as globby from 'globby';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  getDefaultConnectionSettings,
  getDriverClass,
  getDriverType,
} from './driver/driver-factory';
import { ConnectionSettings } from './driver/driver.interface';

const CONFIG_FILE_NAMES = [
  'carno.config.ts',
  'carno.config.js',
  'carno.config.mjs',
  'carno.config.cjs',
] as const;

export function normalizeConfigModule(module: unknown): Partial<ConnectionSettings> {
  if (module == null || typeof module !== 'object') {
    return {};
  }

  let candidate: unknown = (module as Record<string, unknown>).default ?? module;

  for (let depth = 0; depth < 3; depth++) {
    if (candidate == null || typeof candidate !== 'object') {
      break;
    }

    const record = candidate as Record<string, unknown>;
    if (!('default' in record)) {
      break;
    }

    const nested = record.default;
    if (nested == null || nested === candidate) {
      break;
    }

    candidate = nested;
  }

  return (candidate ?? {}) as Partial<ConnectionSettings>;
}

export function findConfigFilePath(cwd = process.cwd()): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const matches = globby.sync(name, { absolute: true, cwd });
    if (matches.length > 0) {
      return matches[0];
    }
  }

  return undefined;
}

async function dynamicImportModule(moduleUrl: string): Promise<unknown> {
  const importModule = new Function(
    'url',
    'return import(url)',
  ) as (url: string) => Promise<unknown>;

  return importModule(moduleUrl);
}

export async function loadConfigModule(cwd = process.cwd()): Promise<unknown | null> {
  const filePath = findConfigFilePath(cwd);
  if (!filePath) {
    return null;
  }

  return dynamicImportModule(pathToFileURL(filePath).href);
}

export function finalizeConnectionConfig(
  partial: Partial<ConnectionSettings> = {},
): ConnectionSettings {
  const driverType = getDriverType();
  const defaults = getDefaultConnectionSettings(driverType);

  return {
    ...defaults,
    ...partial,
    driver: partial.driver ?? getDriverClass(driverType),
  };
}

export async function loadConnectionConfig(
  cwd = process.cwd(),
): Promise<{ settings: ConnectionSettings; module: unknown } | null> {
  const module = await loadConfigModule(cwd);
  if (!module) {
    return null;
  }

  const partial = normalizeConfigModule(module);

  return {
    module,
    settings: finalizeConnectionConfig(partial),
  };
}

export async function importSourceFile(filePath: string): Promise<unknown> {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  return dynamicImportModule(pathToFileURL(resolvedPath).href);
}