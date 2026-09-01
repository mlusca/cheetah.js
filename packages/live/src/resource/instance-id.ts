import { canonical } from '../shared/canonical';
import { fnv1a64 } from '../shared/hash';
import type { LiveShared } from '../metadata';
import type { LiveInputs, LiveScope } from '../shared/inputs';

export class MissingScopeError extends Error {
    constructor(public readonly dimension: 'tenant' | 'principal') {
        super(
            `Live resource requires a ${dimension} in scope but none was resolved. ` +
            'Register a LiveScopeResolver, or declare the resource as @Live({ shared: \'public\' }).'
        );
        this.name = 'MissingScopeError';
    }
}

export class InputTooLargeError extends Error {
    constructor(public readonly size: number, public readonly limit: number) {
        super(`Live subscription inputs are ${size} bytes, over the ${limit} byte limit.`);
        this.name = 'InputTooLargeError';
    }
}

/** The scope half of the instance identity, embedded literally and encoded. */
export function scopeKeyOf(shared: LiveShared, scope: LiveScope): string {
    if (shared === 'public') {
        return 'pub';
    }

    if (shared === 'tenant') {
        if (scope.tenant === undefined || scope.tenant === null || scope.tenant === '') {
            throw new MissingScopeError('tenant');
        }

        return `t:${encodeURIComponent(String(scope.tenant))}`;
    }

    if (scope.principal === undefined || scope.principal === null || scope.principal === '') {
        throw new MissingScopeError('principal');
    }

    return `p:${encodeURIComponent(String(scope.principal))}`;
}

/** Canonical form of inputs, guarded by the size ceiling. */
export function canonicalInputs(inputs: LiveInputs, maxInputBytes: number): string {
    const encoded = canonical({ params: inputs.params ?? {}, query: inputs.query ?? {} });
    const size = Buffer.byteLength(encoded, 'utf8');

    if (size > maxInputBytes) {
        throw new InputTooLargeError(size, maxInputBytes);
    }

    return encoded;
}

/** Same resource, scope and inputs means one compute, one diff and N sends. */
export function instanceIdOf(resourceId: string, scopeKey: string, canonicalInputsValue: string): string {
    return `${resourceId}|${scopeKey}|${fnv1a64(canonicalInputsValue)}`;
}
