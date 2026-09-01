import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { HttpMethod, RouteLive, RouteSchema, RouteSlot, ScanResult, ScanWarning } from './types';
import type { ResolvedClientOptions } from './options';
import { collectSourceFiles } from './glob';
import {
    normalizeControllerPath,
    normalizeMethodPath,
    normalizeRoutePath,
    pathParamNames
} from './normalize';
import { resolveStringLiteral, trimNodeText } from './resolve-path';
import {
    collectAliases,
    createSerializeContext,
    isOptionalType,
    omitUndefined,
    serializeResponseType,
    serializeType,
    type SerializeContext
} from './serialize-type';

const HTTP_DECORATORS: Record<string, HttpMethod> = {
    Get: 'get',
    Post: 'post',
    Put: 'put',
    Delete: 'delete',
    Patch: 'patch',
    Head: 'head',
    Options: 'options'
};

const PARAM_DECORATORS = new Set(['Param', 'Query', 'Body', 'Header']);

interface ControllerIR {
    id: string;
    name: string;
    path: string;
    pathSource?: string;
    children: string[];
    routes: CollectedRoute[];
    filePath: string;
}

interface CollectedRoute {
    method: HttpMethod;
    relativePath: string;
    pathSource?: string;
    handlerName: string;
    params: RouteSlot[];
    query: RouteSlot[];
    headers: RouteSlot[];
    body: RouteSlot[];
    response: string;
    live?: RouteLive;
}

export function scanProject(options: ResolvedClientOptions, files?: string[]): ScanResult {
    const sourceFiles = files ?? collectSourceFiles(options.root, options.include, options.exclude, options.output);
    const warnings: ScanWarning[] = [];

    if (sourceFiles.length === 0) {
        warnings.push({ message: `No TypeScript files matched ${options.include.join(', ')} under ${options.root}` });
        return { routes: [], warnings, aliases: [] };
    }

    const compilerOptions = loadCompilerOptions(options);
    const host = ts.createCompilerHost(compilerOptions, true);
    const program = ts.createProgram({
        rootNames: sourceFiles,
        options: compilerOptions,
        host
    });
    const checker = program.getTypeChecker();
    const ctx = createSerializeContext(checker, program);
    const controllers = new Map<string, ControllerIR>();

    for (const fileName of sourceFiles) {
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile || sourceFile.isDeclarationFile) {
            continue;
        }

        visitNode(sourceFile, (node) => {
            if (!ts.isClassDeclaration(node) || !node.name) {
                return;
            }

            const controllerDec = findDecorator(node, 'Controller');
            if (!controllerDec) {
                return;
            }

            const ir = readController(node, controllerDec, sourceFile, checker, ctx, warnings);
            controllers.set(ir.id, ir);
        });
    }

    const childIds = new Set<string>();
    for (const controller of controllers.values()) {
        for (const child of controller.children) {
            childIds.add(child);
        }
    }

    const routes: RouteSchema[] = [];
    for (const controller of controllers.values()) {
        if (childIds.has(controller.id)) {
            continue;
        }
        flattenController(controller, '', controllers, routes, warnings);
    }

    routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    return {
        routes,
        warnings,
        aliases: collectAliases(ctx)
    };
}

function loadCompilerOptions(options: ResolvedClientOptions): ts.CompilerOptions {
    const defaults: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: false
    };

    const configPath = resolveTsconfig(options);
    if (!configPath) {
        return defaults;
    }

    const read = ts.readConfigFile(configPath, (file) => fs.readFileSync(file, 'utf8'));
    if (read.error) {
        return defaults;
    }

    const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configPath)
    );

    return {
        ...parsed.options,
        ...defaults,
        paths: parsed.options.paths,
        baseUrl: parsed.options.baseUrl ?? path.dirname(configPath)
    };
}

function resolveTsconfig(options: ResolvedClientOptions): string | undefined {
    if (options.tsconfig) {
        const abs = path.isAbsolute(options.tsconfig)
            ? options.tsconfig
            : path.resolve(options.root, options.tsconfig);
        return fs.existsSync(abs) ? abs : undefined;
    }

    return ts.findConfigFile(options.root, (file) => fs.existsSync(file), 'tsconfig.json');
}

function readController(
    node: ts.ClassDeclaration,
    decorator: ts.Decorator,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    ctx: SerializeContext,
    warnings: ScanWarning[]
): ControllerIR {
    const name = node.name!.text;
    const filePath = sourceFile.fileName;
    const id = symbolId(checker.getSymbolAtLocation(node.name!) ?? node.name!.text, checker, filePath, name);
    const arg = firstDecoratorArg(decorator);

    let controllerPath = '';
    let pathSource: string | undefined;
    const children: string[] = [];

    if (arg) {
        if (ts.isObjectLiteralExpression(arg)) {
            const pathExpr = getObjectProperty(arg, 'path');
            if (pathExpr) {
                const resolved = resolveStringLiteral(pathExpr, checker);
                pathSource = resolved.source || undefined;
                if (resolved.warning) {
                    warnings.push(locate(resolved.warning, sourceFile, pathExpr));
                } else {
                    controllerPath = normalizeControllerPath(resolved.value ?? '');
                }
            }

            const childrenExpr = getObjectProperty(arg, 'children');
            if (childrenExpr && ts.isArrayLiteralExpression(childrenExpr)) {
                for (const element of childrenExpr.elements) {
                    const childId = resolveChildId(element, checker);
                    if (childId) {
                        children.push(childId);
                    } else {
                        warnings.push(locate(
                            `Could not resolve child controller \`${trimNodeText(element)}\``,
                            sourceFile,
                            element
                        ));
                    }
                }
            }
        } else {
            const resolved = resolveStringLiteral(arg, checker);
            pathSource = resolved.source || undefined;
            if (resolved.warning) {
                warnings.push(locate(resolved.warning, sourceFile, arg));
            } else {
                controllerPath = normalizeControllerPath(resolved.value ?? '');
            }
        }
    }

    const routes: CollectedRoute[] = [];

    for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) {
            continue;
        }

        const http = findHttpDecorator(member);
        if (!http) {
            continue;
        }

        const route = readRoute(member, http.decorator, http.method, sourceFile, checker, ctx, warnings);
        if (route) {
            routes.push(route);
        }
    }

    return { id, name, path: controllerPath, pathSource, children, routes, filePath };
}

function readRoute(
    method: ts.MethodDeclaration,
    decorator: ts.Decorator,
    httpMethod: HttpMethod,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    ctx: SerializeContext,
    warnings: ScanWarning[]
): CollectedRoute | undefined {
    const handlerName = methodName(method);
    const arg = firstDecoratorArg(decorator);
    let relativePath = '/';
    let pathSource: string | undefined;

    if (arg) {
        const resolved = resolveStringLiteral(arg, checker);
        pathSource = resolved.source || undefined;
        if (resolved.value === undefined) {
            warnings.push(locate(
                resolved.warning ?? `Skipping ${handlerName}: path is not a string literal`,
                sourceFile,
                arg
            ));
            return undefined;
        }
        relativePath = normalizeMethodPath(resolved.value);
    } else {
        relativePath = '/';
    }

    const params: RouteSlot[] = [];
    const query: RouteSlot[] = [];
    const headers: RouteSlot[] = [];
    const body: RouteSlot[] = [];

    for (const parameter of method.parameters) {
        const paramDecorator = findParamDecorator(parameter);
        if (!paramDecorator) {
            continue;
        }

        const key = decoratorKey(paramDecorator.decorator, checker);
        const type = checker.getTypeAtLocation(parameter);
        const optional = !!parameter.questionToken || isOptionalType(type);
        const serialized = omitUndefined(serializeType(type, ctx, parameter));
        const slot: RouteSlot = {
            name: key,
            type: serialized,
            optional
        };

        if (paramDecorator.kind === 'Param') {
            params.push(slot);
        } else if (paramDecorator.kind === 'Query') {
            query.push(slot);
        } else if (paramDecorator.kind === 'Header') {
            headers.push(slot);
        } else if (paramDecorator.kind === 'Body') {
            body.push(slot);
        }
    }

    const signature = checker.getSignatureFromDeclaration(method);
    const returnType = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(method);
    const response = serializeResponseType(returnType, ctx, method);

    const live = readLive(method, checker);

    return {
        method: httpMethod,
        relativePath,
        pathSource,
        handlerName,
        params,
        query,
        headers,
        body,
        response,
        live
    };
}

const LIVE_SHARED = new Set(['private', 'tenant', 'public']);

/**
 * Read @Live({ shared, key }) off a handler.
 *
 * Only string literals are read. A computed value cannot be resolved at build
 * time, and guessing one would put a wrong `shared` in the bundle — which is
 * the field that decides whether two users may share a computed instance.
 */
function readLive(method: ts.MethodDeclaration, checker: ts.TypeChecker): RouteLive | undefined {
    const decorator = findDecorator(method, 'Live');

    if (!decorator) {
        return undefined;
    }

    const live: RouteLive = { shared: 'private' };
    const arg = firstDecoratorArg(decorator);

    if (!arg || !ts.isObjectLiteralExpression(arg)) {
        return live;
    }

    const sharedExpr = getObjectProperty(arg, 'shared');

    if (sharedExpr) {
        const resolved = resolveStringLiteral(sharedExpr, checker);

        if (resolved.value && LIVE_SHARED.has(resolved.value)) {
            live.shared = resolved.value as RouteLive['shared'];
        }
    }

    const keyExpr = getObjectProperty(arg, 'key');

    if (keyExpr) {
        const resolved = resolveStringLiteral(keyExpr, checker);

        if (resolved.value) {
            live.key = resolved.value;
        }
    }

    return live;
}

function flattenController(
    controller: ControllerIR,
    parentPath: string,
    controllers: Map<string, ControllerIR>,
    routes: RouteSchema[],
    warnings: ScanWarning[],
    stack: string[] = []
): void {
    if (stack.includes(controller.id)) {
        warnings.push({
            message: `Cycle detected in controller children: ${[...stack, controller.id].join(' -> ')}`,
            file: controller.filePath
        });
        return;
    }

    const basePath = parentPath + (controller.path || '');

    for (const route of controller.routes) {
        const fullPath = normalizeRoutePath(basePath + route.relativePath);
        const params = mergePathParams(fullPath, route.params);

        routes.push({
            method: route.method,
            path: fullPath,
            relativePath: route.relativePath,
            pathSource: route.pathSource ?? controller.pathSource,
            handlerName: route.handlerName,
            controllerName: controller.name,
            filePath: controller.filePath,
            params,
            query: route.query,
            headers: route.headers,
            body: route.body,
            response: route.response,
            live: route.live
        });
    }

    for (const childId of controller.children) {
        const child = controllers.get(childId);
        if (!child) {
            warnings.push({
                message: `Child controller \`${childId.split('::').pop()}\` of ${controller.name} was not found`,
                file: controller.filePath
            });
            continue;
        }

        flattenController(child, basePath, controllers, routes, warnings, [...stack, controller.id]);
    }
}

function mergePathParams(path: string, slots: RouteSlot[]): RouteSlot[] {
    const fromPath = pathParamNames(path);
    const byName = new Map<string, RouteSlot>();

    for (const slot of slots) {
        if (slot.name) {
            byName.set(slot.name, slot);
        }
    }

    const merged: RouteSlot[] = [];
    const seen = new Set<string>();

    for (const name of fromPath) {
        seen.add(name);
        merged.push(byName.get(name) ?? { name, type: 'string' });
    }

    for (const slot of slots) {
        if (!slot.name) {
            merged.push(slot);
            continue;
        }
        if (!seen.has(slot.name)) {
            merged.push(slot);
        }
    }

    return merged;
}

function findDecorator(node: ts.Node, name: string): ts.Decorator | undefined {
    return getNodeDecorators(node).find((decorator) => decoratorName(decorator) === name);
}

function findHttpDecorator(node: ts.Node): { decorator: ts.Decorator; method: HttpMethod } | undefined {
    for (const decorator of getNodeDecorators(node)) {
        const name = decoratorName(decorator);
        if (name && name in HTTP_DECORATORS) {
            return { decorator, method: HTTP_DECORATORS[name] };
        }
    }
    return undefined;
}

function findParamDecorator(parameter: ts.ParameterDeclaration): { decorator: ts.Decorator; kind: string } | undefined {
    for (const decorator of getNodeDecorators(parameter)) {
        const name = decoratorName(decorator);
        if (name && PARAM_DECORATORS.has(name)) {
            return { decorator, kind: name };
        }
    }
    return undefined;
}

function getNodeDecorators(node: ts.Node): readonly ts.Decorator[] {
    if (ts.canHaveDecorators(node)) {
        return ts.getDecorators(node) ?? [];
    }

    const legacy = (node as { decorators?: readonly ts.Decorator[] }).decorators;
    return legacy ?? [];
}

function decoratorName(decorator: ts.Decorator): string | undefined {
    let expr: ts.Expression = decorator.expression;
    if (ts.isCallExpression(expr)) {
        expr = expr.expression;
    }
    if (ts.isIdentifier(expr)) {
        return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr)) {
        return expr.name.text;
    }
    return undefined;
}

function firstDecoratorArg(decorator: ts.Decorator): ts.Expression | undefined {
    if (ts.isCallExpression(decorator.expression)) {
        return decorator.expression.arguments[0];
    }
    return undefined;
}

function decoratorKey(decorator: ts.Decorator, checker: ts.TypeChecker): string | undefined {
    const arg = firstDecoratorArg(decorator);
    if (!arg) {
        return undefined;
    }

    const resolved = resolveStringLiteral(arg, checker);
    return resolved.value;
}

function getObjectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    for (const property of object.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) {
            return property.initializer;
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
            return property.name;
        }
    }
    return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function resolveChildId(node: ts.Expression, checker: ts.TypeChecker): string | undefined {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(ts.isIdentifier(node) ? node : node.name);
        if (!symbol) {
            return undefined;
        }
        const resolved = resolveAliased(symbol, checker);
        const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
        const filePath = decl?.getSourceFile().fileName ?? '';
        return symbolId(resolved, checker, filePath, resolved.getName());
    }
    return undefined;
}

function resolveAliased(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
    if (symbol.flags & ts.SymbolFlags.Alias) {
        return checker.getAliasedSymbol(symbol);
    }
    return symbol;
}

function symbolId(symbol: ts.Symbol | string, checker: ts.TypeChecker, filePath: string, name: string): string {
    if (typeof symbol === 'string') {
        return `${filePath}::${name}`;
    }

    const resolved = resolveAliased(symbol, checker);
    const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
    const file = decl?.getSourceFile().fileName ?? filePath;
    return `${file}::${resolved.getName()}`;
}

function methodName(method: ts.MethodDeclaration): string {
    if (ts.isIdentifier(method.name)) {
        return method.name.text;
    }
    return method.name.getText();
}

function visitNode(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (child) => visitNode(child, visit));
}

function locate(message: string, sourceFile: ts.SourceFile, node: ts.Node): ScanWarning {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
    return {
        message,
        file: sourceFile.fileName,
        line: line + 1
    };
}
