import ts from 'typescript';
import type { TypeAlias } from './types';
import { isValidIdentifier, quoteProp } from './normalize';

export interface SerializeContext {
    checker: ts.TypeChecker;
    program: ts.Program;
    aliases: Map<string, string>;
    usedNames: Set<string>;
    visiting: WeakMap<ts.Type, string>;
}

const LIB_NAMES = new Set([
    'Array',
    'ReadonlyArray',
    'Promise',
    'PromiseLike',
    'Function',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'BigInt',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Record',
    'Partial',
    'Required',
    'Pick',
    'Omit',
    'Readonly',
    'Extract',
    'Exclude',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'Awaited'
]);

export function createSerializeContext(checker: ts.TypeChecker, program: ts.Program): SerializeContext {
    return {
        checker,
        program,
        aliases: new Map(),
        usedNames: new Set(),
        visiting: new WeakMap()
    };
}

export function collectAliases(ctx: SerializeContext): TypeAlias[] {
    return [...ctx.aliases.entries()].map(([name, type]) => ({ name, type }));
}

export function serializeResponseType(type: ts.Type, ctx: SerializeContext, node?: ts.Node): string {
    const unwrapped = unwrapPromise(type, ctx.checker);

    if (isVoidish(unwrapped)) {
        return 'null';
    }

    if (unwrapped.isUnion()) {
        const parts = unique(unwrapped.types.map((member) => {
            if (isVoidish(member)) {
                return 'null';
            }
            return serializeType(member, ctx, node);
        }));
        return parts.join(' | ') || 'null';
    }

    return serializeType(type, ctx, node);
}

export function serializeType(type: ts.Type, ctx: SerializeContext, node?: ts.Node): string {
    type = unwrapPromise(type, ctx.checker);

    if (isResponseType(type, ctx)) {
        return 'unknown';
    }

    const flags = type.flags;

    if (flags & ts.TypeFlags.Any) return 'any';
    if (flags & ts.TypeFlags.Unknown) return 'unknown';
    if (flags & ts.TypeFlags.Never) return 'never';
    if (flags & ts.TypeFlags.Void) return 'undefined';
    if (flags & ts.TypeFlags.Undefined) return 'undefined';
    if (flags & ts.TypeFlags.Null) return 'null';
    if (flags & ts.TypeFlags.String && !(flags & ts.TypeFlags.StringLiteral)) return 'string';
    if (flags & ts.TypeFlags.Number && !(flags & ts.TypeFlags.NumberLiteral) && !(flags & ts.TypeFlags.EnumLike)) {
        return 'number';
    }
    if (flags & ts.TypeFlags.Boolean && !(flags & ts.TypeFlags.BooleanLiteral)) return 'boolean';
    if (flags & ts.TypeFlags.BigInt && !(flags & ts.TypeFlags.BigIntLiteral)) return 'bigint';
    if (flags & ts.TypeFlags.ESSymbol) return 'symbol';
    if (flags & ts.TypeFlags.NonPrimitive && !(flags & ts.TypeFlags.Object)) return 'object';

    if (type.isStringLiteral()) return JSON.stringify(type.value);
    if (type.isNumberLiteral()) return String(type.value);
    if (flags & ts.TypeFlags.BigIntLiteral) {
        const literal = type as ts.BigIntLiteralType;
        return `${literal.value.negative ? '-' : ''}${literal.value.base10Value}n`;
    }
    if (flags & ts.TypeFlags.BooleanLiteral) {
        return ctx.checker.typeToString(type);
    }

    if (type.isUnion()) {
        const parts = unique(type.types.map((t) => serializeType(t, ctx, node)));
        if (parts.includes('any')) return 'any';
        return parts.join(' | ') || 'unknown';
    }

    if (type.isIntersection()) {
        return unique(type.types.map((t) => serializeType(t, ctx, node))).join(' & ') || 'unknown';
    }

    if (ctx.checker.isTupleType(type)) {
        const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
        return `[${typeArgs.map((t) => serializeType(t, ctx, node)).join(', ')}]`;
    }

    if (ctx.checker.isArrayType(type)) {
        const element = getArrayElementType(type, ctx.checker);
        const inner = element ? serializeType(element, ctx, node) : 'unknown';
        return needsParens(inner) ? `(${inner})[]` : `${inner}[]`;
    }

    if (isDateType(type, ctx)) {
        return 'string';
    }

    const existing = ctx.visiting.get(type);
    if (existing) {
        return existing;
    }

    const named = declaredTypeName(type, ctx);
    if (named) {
        ctx.visiting.set(type, named);
        if (!ctx.aliases.has(named)) {
            ctx.aliases.set(named, serializeObjectLike(type, ctx, node));
        }
        return named;
    }

    return serializeObjectLike(type, ctx, node);
}

function serializeObjectLike(type: ts.Type, ctx: SerializeContext, node?: ts.Node): string {
    const indexInfos = ctx.checker.getIndexInfosOfType(type);
    const props = type.getApparentProperties().filter((symbol) => isDataProperty(symbol, ctx, node));

    if (!props.length && !indexInfos.length) {
        if (type.getCallSignatures().length || type.getConstructSignatures().length) {
            return 'unknown';
        }
        return 'Record<string, never>';
    }

    const fields: string[] = [];

    for (const symbol of props) {
        const name = symbol.getName();
        if (name.startsWith('__')) {
            continue;
        }

        const optional = !!(symbol.flags & ts.SymbolFlags.Optional);
        const location = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? node;
        const propType = location
            ? ctx.checker.getTypeOfSymbolAtLocation(symbol, location)
            : ctx.checker.getTypeOfSymbol(symbol);
        let serialized = serializeType(propType, ctx, location);
        if (optional) {
            serialized = omitUndefined(serialized);
        }
        fields.push(`${quoteProp(name)}${optional ? '?' : ''}: ${serialized}`);
    }

    for (const info of indexInfos) {
        const key = info.keyType.flags & ts.TypeFlags.Number ? 'number' : 'string';
        fields.push(`[key: ${key}]: ${serializeType(info.type, ctx, node)}`);
    }

    return `{ ${fields.join('; ')} }`;
}

function isDataProperty(symbol: ts.Symbol, ctx: SerializeContext, node?: ts.Node): boolean {
    if (symbol.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Signature)) {
        return false;
    }

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (decl) {
        const mods = ts.getCombinedModifierFlags(decl);
        if (mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)) {
            return false;
        }
        if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) {
            return false;
        }
    }

    const location = decl ?? node;
    if (location) {
        const propType = ctx.checker.getTypeOfSymbolAtLocation(symbol, location);
        if (propType.getCallSignatures().length > 0 && propType.getApparentProperties().length === 0) {
            return false;
        }
    }

    return true;
}

function isVoidish(type: ts.Type): boolean {
    return !!(type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined));
}

function unwrapPromise(type: ts.Type, checker: ts.TypeChecker): ts.Type {
    const promised = getPromiseElementType(type, checker);
    if (promised) {
        return unwrapPromise(promised, checker);
    }

    return type;
}

function getPromiseElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const name = symbol?.getName();
    if (name === 'Promise' || name === 'PromiseLike' || name === 'Awaited') {
        const args = getReferenceTypeArguments(type, checker);
        if (args[0]) {
            return args[0];
        }
    }

    return undefined;
}

function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
    const args = getReferenceTypeArguments(type, checker);
    if (args[0]) {
        return args[0];
    }

    return type.getNumberIndexType();
}

function getReferenceTypeArguments(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
    if (!isTypeReference(type)) {
        return [];
    }

    return checker.getTypeArguments(type);
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
    return !!(type.flags & ts.TypeFlags.Object)
        && !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference);
}

function isResponseType(type: ts.Type, ctx: SerializeContext): boolean {
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    if (symbol?.getName() !== 'Response') {
        return false;
    }

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!decl) {
        return true;
    }

    const file = decl.getSourceFile();
    return ctx.program.isSourceFileDefaultLibrary(file) || file.fileName.includes('lib.dom') || file.fileName.includes('bun-types');
}

function isDateType(type: ts.Type, ctx: SerializeContext): boolean {
    const symbol = type.getSymbol();
    if (symbol?.getName() !== 'Date') {
        return false;
    }

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!decl) {
        return true;
    }

    const file = decl.getSourceFile();
    return ctx.program.isSourceFileDefaultLibrary(file) || /typescript[\\/]lib/i.test(file.fileName);
}

function declaredTypeName(type: ts.Type, ctx: SerializeContext): string | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (!symbol) {
        return undefined;
    }

    const name = symbol.getName();
    if (!name || name === '__type' || name === '__object' || name === '__class' || LIB_NAMES.has(name)) {
        return undefined;
    }

    if (!isValidIdentifier(name) || name === 'Array' || name === 'Function') {
        return undefined;
    }

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!decl) {
        return undefined;
    }

    const file = decl.getSourceFile();
    if (ctx.program.isSourceFileDefaultLibrary(file) || file.fileName.includes('node_modules')) {
        return undefined;
    }

    if (
        !ts.isClassDeclaration(decl) &&
        !ts.isInterfaceDeclaration(decl) &&
        !ts.isTypeAliasDeclaration(decl) &&
        !ts.isEnumDeclaration(decl)
    ) {
        return undefined;
    }

    if (ctx.aliases.has(name) && ctx.visiting.get(type) !== name) {
        return uniqueName(name, ctx);
    }

    ctx.usedNames.add(name);
    return name;
}

function uniqueName(base: string, ctx: SerializeContext): string {
    let i = 2;
    let candidate = `${base}_${i}`;
    while (ctx.usedNames.has(candidate) || ctx.aliases.has(candidate)) {
        i += 1;
        candidate = `${base}_${i}`;
    }
    ctx.usedNames.add(candidate);
    return candidate;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function needsParens(type: string): boolean {
    return type.includes('|') || type.includes('&');
}

export function isOptionalType(type: ts.Type): boolean {
    if (type.flags & ts.TypeFlags.Undefined) {
        return true;
    }

    if (type.isUnion()) {
        return type.types.some((t) => !!(t.flags & ts.TypeFlags.Undefined));
    }

    return false;
}

export function omitUndefined(typeText: string): string {
    return typeText
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part && part !== 'undefined')
        .join(' | ') || 'unknown';
}
