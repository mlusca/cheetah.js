import ts from 'typescript';

export interface ResolvedLiteral {
    value?: string;
    source: string;
    warning?: string;
}

export function resolveStringLiteral(
    node: ts.Expression | undefined,
    checker: ts.TypeChecker
): ResolvedLiteral {
    if (!node) {
        return { value: '', source: '' };
    }

    const source = trimNodeText(node);
    const value = evalString(node, checker, new Set());

    if (value !== undefined) {
        return { value, source };
    }

    return {
        source,
        warning: `Could not resolve path expression \`${source}\` to a string literal`
    };
}

export function trimNodeText(node: ts.Node): string {
    return node.getText().replace(/\s+/g, ' ').trim();
}

function evalString(node: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): string | undefined {
    if (seen.has(node)) {
        return undefined;
    }
    seen.add(node);

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
        return evalString(node.expression, checker, seen);
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }

    if (ts.isTemplateExpression(node)) {
        let out = node.head.text;
        for (const span of node.templateSpans) {
            const part = evalString(span.expression, checker, seen);
            if (part === undefined) {
                return undefined;
            }
            out += part + span.literal.text;
        }
        return out;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = evalString(node.left, checker, seen);
        const right = evalString(node.right, checker, seen);
        if (left !== undefined && right !== undefined) {
            return left + right;
        }
    }

    const type = checker.getTypeAtLocation(node);
    if (type.isStringLiteral()) {
        return type.value;
    }
    if (type.isNumberLiteral()) {
        return String(type.value);
    }
    if (type.flags & ts.TypeFlags.TemplateLiteral) {
        const value = templateLiteralValue(type as ts.TemplateLiteralType);
        if (value !== undefined) {
            return value;
        }
    }

    if (ts.isIdentifier(node)) {
        const initializer = identifierInitializer(node, checker);
        if (initializer) {
            return evalString(initializer, checker, seen);
        }
    }

    if (ts.isPropertyAccessExpression(node)) {
        const fromObject = propertyInitializer(node, checker);
        if (fromObject) {
            return evalString(fromObject, checker, seen);
        }
    }

    return undefined;
}

function identifierInitializer(node: ts.Identifier, checker: ts.TypeChecker): ts.Expression | undefined {
    const symbol = resolveAlias(checker.getSymbolAtLocation(node), checker);
    const decl = symbol?.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        return decl.initializer;
    }
    if (decl && ts.isBindingElement(decl) && decl.initializer) {
        return decl.initializer;
    }
    return undefined;
}

function propertyInitializer(node: ts.PropertyAccessExpression, checker: ts.TypeChecker): ts.Expression | undefined {
    const key = node.name.text;
    const objectInit = ts.isIdentifier(node.expression)
        ? identifierInitializer(node.expression, checker)
        : undefined;

    const literal = objectInit ? unwrap(objectInit) : undefined;
    if (literal && ts.isObjectLiteralExpression(literal)) {
        for (const property of literal.properties) {
            if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) {
                return property.initializer;
            }
            if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
                return property.name;
            }
        }
    }

    const type = checker.getTypeAtLocation(node.expression);
    const prop = type.getProperty(key);
    const decl = prop?.valueDeclaration ?? prop?.declarations?.[0];
    if (decl && ts.isPropertyAssignment(decl)) {
        return decl.initializer;
    }

    return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
        return unwrap(node.expression);
    }
    return node;
}

function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function resolveAlias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
    if (!symbol) {
        return undefined;
    }
    if (symbol.flags & ts.SymbolFlags.Alias) {
        return checker.getAliasedSymbol(symbol);
    }
    return symbol;
}

function templateLiteralValue(type: ts.TemplateLiteralType): string | undefined {
    if (!type.texts.length) {
        return undefined;
    }

    let out = type.texts[0] ?? '';

    for (let i = 0; i < type.types.length; i++) {
        const part = type.types[i];
        if (!part.isStringLiteral() && !part.isNumberLiteral()) {
            return undefined;
        }
        out += String(part.value) + (type.texts[i + 1] ?? '');
    }

    return out;
}
