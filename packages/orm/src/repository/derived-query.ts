import type { FilterQuery, QueryOrderMap } from '../driver/driver.interface';
import { EntityStorage, Options } from '../domain/entities';

type DerivedOperation = 'findOne' | 'findMany' | 'count' | 'exists' | 'delete';
type PredicateOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'nin'
  | 'like'
  | 'notLike'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'null'
  | 'notNull'
  | 'true'
  | 'false';

type ParsedPredicate = {
  property: string;
  operator: PredicateOperator;
};

type ParsedOrder = {
  property: string;
  direction: 'ASC' | 'DESC';
};

export type DerivedQueryPlan<T extends object = any> = {
  methodName: string;
  operation: DerivedOperation;
  predicates: ParsedPredicate[];
  connectors: Array<'And' | 'Or'>;
  orderBy?: QueryOrderMap<T>;
  limit?: number;
  parameterCount: number;
};

type EntityNameMap = {
  entity: Options;
  propertyByToken: Map<string, string>;
  propertyTokens: string[];
};

type OperatorSpec = {
  token: string;
  operator: PredicateOperator;
  args: number;
};

const OPERATORS: OperatorSpec[] = [
  { token: 'GreaterThanEqual', operator: 'gte', args: 1 },
  { token: 'LessThanEqual', operator: 'lte', args: 1 },
  { token: 'NotContaining', operator: 'notContains', args: 1 },
  { token: 'StartingWith', operator: 'startsWith', args: 1 },
  { token: 'GreaterThan', operator: 'gt', args: 1 },
  { token: 'EndingWith', operator: 'endsWith', args: 1 },
  { token: 'Containing', operator: 'contains', args: 1 },
  { token: 'IsNotNull', operator: 'notNull', args: 0 },
  { token: 'IsNotIn', operator: 'nin', args: 1 },
  { token: 'LessThan', operator: 'lt', args: 1 },
  { token: 'NotLike', operator: 'notLike', args: 1 },
  { token: 'NotNull', operator: 'notNull', args: 0 },
  { token: 'Contains', operator: 'contains', args: 1 },
  { token: 'Between', operator: 'between', args: 2 },
  { token: 'IsNull', operator: 'null', args: 0 },
  { token: 'IsNot', operator: 'ne', args: 1 },
  { token: 'IsTrue', operator: 'true', args: 0 },
  { token: 'IsFalse', operator: 'false', args: 0 },
  { token: 'Equals', operator: 'eq', args: 1 },
  { token: 'Before', operator: 'lt', args: 1 },
  { token: 'After', operator: 'gt', args: 1 },
  { token: 'NotIn', operator: 'nin', args: 1 },
  { token: 'False', operator: 'false', args: 0 },
  { token: 'Null', operator: 'null', args: 0 },
  { token: 'True', operator: 'true', args: 0 },
  { token: 'Like', operator: 'like', args: 1 },
  { token: 'Not', operator: 'ne', args: 1 },
  { token: 'In', operator: 'in', args: 1 },
  { token: 'Is', operator: 'eq', args: 1 },
];

const CONNECTORS = ['And', 'Or'] as const;
const NO_ARG_OPERATORS = new Set<PredicateOperator>(['null', 'notNull', 'true', 'false']);

const planCache = new WeakMap<Function, Map<string, DerivedQueryPlan | null>>();
const nameMapCache = new WeakMap<Function, EntityNameMap>();

export function isDerivedQueryMethodName(methodName: string): boolean {
  return (
    methodName.startsWith('findBy') ||
    methodName.startsWith('findAllBy') ||
    methodName.startsWith('findOneBy') ||
    /^find(?:First|Top)\d*By/.test(methodName) ||
    methodName.startsWith('countBy') ||
    methodName.startsWith('existsBy') ||
    methodName.startsWith('deleteBy')
  );
}

export function getDerivedQueryPlan<T extends object>(
  entityClass: new () => T,
  methodName: string,
): DerivedQueryPlan<T> | undefined {
  let entityPlans = planCache.get(entityClass);

  if (!entityPlans) {
    entityPlans = new Map<string, DerivedQueryPlan | null>();
    planCache.set(entityClass, entityPlans);
  }

  if (entityPlans.has(methodName)) {
    return entityPlans.get(methodName) as DerivedQueryPlan<T> | undefined;
  }

  const plan = parseDerivedQueryMethod<T>(entityClass, methodName);
  entityPlans.set(methodName, plan ?? null);

  return plan;
}

export function parseDerivedQueryMethod<T extends object>(
  entityClass: new () => T,
  methodName: string,
): DerivedQueryPlan<T> | undefined {
  const prefix = parsePrefix(methodName);

  if (!prefix) {
    return undefined;
  }

  const nameMap = getEntityNameMap(entityClass);
  const { criteria, orderBy } = splitOrderBy(prefix.criteria, methodName);

  if (!criteria) {
    throw new Error(`Derived query method "${methodName}" must include at least one predicate after "${prefix.prefix}".`);
  }

  const parsed = parseCriteria(criteria, nameMap, methodName);
  const order = orderBy ? parseOrderBy<T>(orderBy, nameMap, methodName) : undefined;

  return {
    methodName,
    operation: prefix.operation,
    predicates: parsed.predicates,
    connectors: parsed.connectors,
    orderBy: order,
    limit: prefix.limit,
    parameterCount: parsed.parameterCount,
  };
}

export function buildDerivedWhere<T extends object>(
  plan: DerivedQueryPlan<T>,
  args: unknown[],
): FilterQuery<T> {
  const groups: Array<Record<string, any>> = [{}];
  let argIndex = 0;

  for (let i = 0; i < plan.predicates.length; i += 1) {
    if (i > 0 && plan.connectors[i - 1] === 'Or') {
      groups.push({});
    }

    const current = groups[groups.length - 1];
    const predicate = plan.predicates[i];
    const condition = buildPredicateCondition(predicate, () => args[argIndex++]);

    mergeCondition(current, predicate.property, condition);
  }

  if (groups.length === 1) {
    return groups[0] as FilterQuery<T>;
  }

  return { $or: groups } as FilterQuery<T>;
}

function parsePrefix(methodName: string): {
  prefix: string;
  operation: DerivedOperation;
  criteria: string;
  limit?: number;
} | undefined {
  const limited = methodName.match(/^find(First|Top)(\d*)By(.+)$/);

  if (limited) {
    const limitText = limited[2];

    return {
      prefix: `find${limited[1]}${limitText}By`,
      operation: limitText ? 'findMany' : 'findOne',
      criteria: limited[3],
      limit: limitText ? parseLimit(methodName, limitText) : 1,
    };
  }

  const prefixes: Array<[string, DerivedOperation]> = [
    ['findAllBy', 'findMany'],
    ['findOneBy', 'findOne'],
    ['findBy', 'findOne'],
    ['countBy', 'count'],
    ['existsBy', 'exists'],
    ['deleteBy', 'delete'],
  ];

  for (let i = 0; i < prefixes.length; i += 1) {
    const [prefix, operation] = prefixes[i];

    if (methodName.startsWith(prefix)) {
      return {
        prefix,
        operation,
        criteria: methodName.slice(prefix.length),
      };
    }
  }

  return undefined;
}

function parseLimit(methodName: string, limitText: string): number {
  const limit = Number(limitText);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Derived query method "${methodName}" must use a positive Top/First limit.`);
  }

  return limit;
}

function splitOrderBy(criteria: string, methodName: string): { criteria: string; orderBy?: string } {
  const index = criteria.indexOf('OrderBy');

  if (index === -1) {
    return { criteria };
  }

  const orderBy = criteria.slice(index + 'OrderBy'.length);

  if (!orderBy) {
    throw new Error(`Derived query method "${methodName}" has OrderBy without a property.`);
  }

  return {
    criteria: criteria.slice(0, index),
    orderBy,
  };
}

function parseCriteria(criteria: string, nameMap: EntityNameMap, methodName: string): {
  predicates: ParsedPredicate[];
  connectors: Array<'And' | 'Or'>;
  parameterCount: number;
} {
  const predicates: ParsedPredicate[] = [];
  const connectors: Array<'And' | 'Or'> = [];
  let index = 0;
  let parameterCount = 0;

  while (index < criteria.length) {
    const parsed = parsePredicate(criteria, index, nameMap, methodName);

    predicates.push(parsed.predicate);
    parameterCount += operatorArgumentCount(parsed.predicate.operator);
    index = parsed.nextIndex;

    if (index >= criteria.length) {
      break;
    }

    const connector = parseConnector(criteria, index, nameMap);

    if (!connector) {
      throw new Error(
        `Could not parse derived query method "${methodName}" near "${criteria.slice(index)}". ` +
        `Use And/Or between predicates.`,
      );
    }

    connectors.push(connector.connector);
    index = connector.nextIndex;
  }

  return { predicates, connectors, parameterCount };
}

function parsePredicate(
  criteria: string,
  start: number,
  nameMap: EntityNameMap,
  methodName: string,
): { predicate: ParsedPredicate; nextIndex: number } {
  for (let i = 0; i < nameMap.propertyTokens.length; i += 1) {
    const token = nameMap.propertyTokens[i];

    if (!criteria.startsWith(token, start)) {
      continue;
    }

    const afterProperty = start + token.length;
    const suffix = criteria.slice(afterProperty);

    for (let j = 0; j < OPERATORS.length; j += 1) {
      const spec = OPERATORS[j];

      if (suffix.startsWith(spec.token)) {
        return {
          predicate: {
            property: nameMap.propertyByToken.get(token)!,
            operator: spec.operator,
          },
          nextIndex: afterProperty + spec.token.length,
        };
      }
    }

    return {
      predicate: {
        property: nameMap.propertyByToken.get(token)!,
        operator: 'eq',
      },
      nextIndex: afterProperty,
    };
  }

  throw new Error(
    `Could not parse derived query method "${methodName}" near "${criteria.slice(start)}". ` +
    `No matching property exists on entity "${nameMap.entity.tableName}".`,
  );
}

function parseConnector(
  criteria: string,
  start: number,
  nameMap: EntityNameMap,
): { connector: 'And' | 'Or'; nextIndex: number } | undefined {
  for (let i = 0; i < CONNECTORS.length; i += 1) {
    const connector = CONNECTORS[i];
    const nextIndex = start + connector.length;

    if (!criteria.startsWith(connector, start)) {
      continue;
    }

    if (canParsePredicateAt(criteria, nextIndex, nameMap)) {
      return { connector, nextIndex };
    }
  }

  return undefined;
}

function canParsePredicateAt(criteria: string, start: number, nameMap: EntityNameMap): boolean {
  for (let i = 0; i < nameMap.propertyTokens.length; i += 1) {
    if (criteria.startsWith(nameMap.propertyTokens[i], start)) {
      return true;
    }
  }

  return false;
}

function parseOrderBy<T extends object>(
  orderBy: string,
  nameMap: EntityNameMap,
  methodName: string,
): QueryOrderMap<T> {
  const order: Record<string, 'ASC' | 'DESC'> = {};
  let index = 0;

  while (index < orderBy.length) {
    const parsed = parseOrderProperty(orderBy, index, nameMap, methodName);
    order[parsed.property] = parsed.direction;
    index = parsed.nextIndex;
  }

  return order as QueryOrderMap<T>;
}

function parseOrderProperty(
  orderBy: string,
  start: number,
  nameMap: EntityNameMap,
  methodName: string,
): ParsedOrder & { nextIndex: number } {
  for (let i = 0; i < nameMap.propertyTokens.length; i += 1) {
    const token = nameMap.propertyTokens[i];

    if (!orderBy.startsWith(token, start)) {
      continue;
    }

    const directionIndex = start + token.length;
    const direction = orderBy.startsWith('Asc', directionIndex)
      ? 'ASC'
      : orderBy.startsWith('Desc', directionIndex)
        ? 'DESC'
        : undefined;

    if (!direction) {
      throw new Error(
        `OrderBy in derived query method "${methodName}" must use Asc or Desc after "${token}".`,
      );
    }

    return {
      property: nameMap.propertyByToken.get(token)!,
      direction,
      nextIndex: directionIndex + (direction === 'ASC' ? 'Asc'.length : 'Desc'.length),
    };
  }

  throw new Error(
    `Could not parse OrderBy in derived query method "${methodName}" near "${orderBy.slice(start)}".`,
  );
}

function getEntityNameMap<T extends object>(entityClass: new () => T): EntityNameMap {
  const cached = nameMapCache.get(entityClass);

  if (cached) {
    return cached;
  }

  const entity = EntityStorage.getInstance().get(entityClass as Function);

  if (!entity) {
    throw new Error(`Entity metadata not found for ${entityClass.name}`);
  }

  const propertyByToken = new Map<string, string>();

  for (const property of Object.keys(entity.properties || {})) {
    propertyByToken.set(toPascalCase(property), property);
  }

  for (let i = 0; i < entity.relations.length; i += 1) {
    const property = String(entity.relations[i].propertyKey);
    propertyByToken.set(toPascalCase(property), property);
  }

  const propertyTokens = Array.from(propertyByToken.keys())
    .sort((a, b) => b.length - a.length);

  const nameMap = { entity, propertyByToken, propertyTokens };
  nameMapCache.set(entityClass, nameMap);

  return nameMap;
}

function toPascalCase(property: string): string {
  return property.charAt(0).toUpperCase() + property.slice(1);
}

function operatorArgumentCount(operator: PredicateOperator): number {
  if (operator === 'between') {
    return 2;
  }

  if (NO_ARG_OPERATORS.has(operator)) {
    return 0;
  }

  return 1;
}

function buildPredicateCondition(
  predicate: ParsedPredicate,
  nextArg: () => unknown,
): any {
  switch (predicate.operator) {
    case 'eq':
      return nextArg();
    case 'ne':
      return { $ne: nextArg() };
    case 'gt':
      return { $gt: nextArg() };
    case 'gte':
      return { $gte: nextArg() };
    case 'lt':
      return { $lt: nextArg() };
    case 'lte':
      return { $lte: nextArg() };
    case 'between':
      return { $gte: nextArg(), $lte: nextArg() };
    case 'in':
      return { $in: nextArg() };
    case 'nin':
      return { $nin: nextArg() };
    case 'like':
      return { $like: nextArg() };
    case 'notLike':
      return { $notLike: nextArg() };
    case 'contains':
      return { $like: `%${nextArg()}%` };
    case 'notContains':
      return { $notLike: `%${nextArg()}%` };
    case 'startsWith':
      return { $like: `${nextArg()}%` };
    case 'endsWith':
      return { $like: `%${nextArg()}` };
    case 'null':
      return null;
    case 'notNull':
      return { $ne: null };
    case 'true':
      return true;
    case 'false':
      return false;
  }
}

function mergeCondition(target: Record<string, any>, property: string, condition: any): void {
  const current = target[property];

  if (
    current &&
    condition &&
    typeof current === 'object' &&
    typeof condition === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(condition)
  ) {
    target[property] = { ...current, ...condition };
    return;
  }

  target[property] = condition;
}
