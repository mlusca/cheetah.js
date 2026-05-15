import { describe, expect, test } from 'bun:test';
import { Entity, EntityStorage, PrimaryKey, Property } from '../../src';
import { PROPERTIES_METADATA } from '../../src/constants';
import { buildDerivedWhere, parseDerivedQueryMethod } from '../../src/repository/derived-query';
import { Metadata } from '@carno.js/core';

@Entity({ tableName: 'parser_user' })
class ParserUser {
  @PrimaryKey()
  id: number;

  @Property()
  email: string;

  @Property()
  name: string;

  @Property()
  status: string;

  @Property()
  age: number;

  @Property()
  active: boolean;

  @Property()
  orderIndex: number;

  @Property()
  createdAt: Date;

  @Property()
  deletedAt: Date;
}

function registerParserUser() {
  const storage = new EntityStorage();
  const properties = Metadata.get(PROPERTIES_METADATA, ParserUser) || {};
  storage.add({ target: ParserUser, options: { tableName: 'parser_user' } }, properties, [], []);
  return storage;
}

describe('Derived query parser', () => {
  test('parses equality and And predicates', () => {
    registerParserUser();

    const plan = parseDerivedQueryMethod(ParserUser, 'findAllByNameAndStatus')!;

    expect(plan.operation).toBe('findMany');
    expect(plan.parameterCount).toBe(2);
    expect(buildDerivedWhere(plan, ['Alice', 'active'])).toEqual({
      name: 'Alice',
      status: 'active',
    });
  });

  test('parses Or groups with comparison operators', () => {
    registerParserUser();

    const plan = parseDerivedQueryMethod(ParserUser, 'findAllByStatusOrAgeLessThan')!;

    expect(buildDerivedWhere(plan, ['active', 18])).toEqual({
      $or: [
        { status: 'active' },
        { age: { $lt: 18 } },
      ],
    });
  });

  test('parses zero and two argument operators', () => {
    registerParserUser();

    const plan = parseDerivedQueryMethod(ParserUser, 'findAllByDeletedAtIsNullAndAgeBetweenAndActiveIsTrue')!;

    expect(plan.parameterCount).toBe(2);
    expect(buildDerivedWhere(plan, [18, 30])).toEqual({
      deletedAt: null,
      age: { $gte: 18, $lte: 30 },
      active: true,
    });
  });

  test('parses pattern operators and OrderBy without splitting property names containing Or', () => {
    registerParserUser();

    const plan = parseDerivedQueryMethod(ParserUser, 'findTop2ByNameContainingOrderByOrderIndexDesc')!;

    expect(plan.operation).toBe('findMany');
    expect(plan.limit).toBe(2);
    expect(plan.orderBy).toEqual({ orderIndex: 'DESC' });
    expect(buildDerivedWhere(plan, ['li'])).toEqual({
      name: { $like: '%li%' },
    });
  });

  test('rejects unknown properties with a useful error', () => {
    registerParserUser();

    expect(() => parseDerivedQueryMethod(ParserUser, 'findAllByMissingField')).toThrow(
      /No matching property exists/,
    );
  });

  test('rejects non-positive Top/First limits', () => {
    registerParserUser();

    expect(() => parseDerivedQueryMethod(ParserUser, 'findTop0ByEmail')).toThrow(
      /positive Top\/First limit/,
    );
  });

  test('parses every supported operation prefix', () => {
    registerParserUser();

    const cases = [
      ['findByEmail', 'findOne', undefined],
      ['findOneByEmail', 'findOne', undefined],
      ['findAllByEmail', 'findMany', undefined],
      ['findFirstByEmail', 'findOne', 1],
      ['findTopByEmail', 'findOne', 1],
      ['findFirst3ByEmail', 'findMany', 3],
      ['findTop3ByEmail', 'findMany', 3],
      ['countByEmail', 'count', undefined],
      ['existsByEmail', 'exists', undefined],
      ['deleteByEmail', 'delete', undefined],
    ] as const;

    for (const [methodName, operation, limit] of cases) {
      const plan = parseDerivedQueryMethod(ParserUser, methodName)!;

      expect(plan.operation).toBe(operation);
      expect(plan.limit).toBe(limit);
      expect(plan.parameterCount).toBe(1);
    }
  });

  test('parses every supported equality, negation, comparison, and set operator', () => {
    registerParserUser();

    const cases: Array<[string, unknown[], Record<string, any>]> = [
      ['findAllByEmail', ['a@example.com'], { email: 'a@example.com' }],
      ['findAllByEmailIs', ['a@example.com'], { email: 'a@example.com' }],
      ['findAllByEmailEquals', ['a@example.com'], { email: 'a@example.com' }],
      ['findAllByStatusNot', ['archived'], { status: { $ne: 'archived' } }],
      ['findAllByStatusIsNot', ['archived'], { status: { $ne: 'archived' } }],
      ['findAllByAgeGreaterThan', [18], { age: { $gt: 18 } }],
      ['findAllByAgeGreaterThanEqual', [18], { age: { $gte: 18 } }],
      ['findAllByAgeLessThan', [65], { age: { $lt: 65 } }],
      ['findAllByAgeLessThanEqual', [65], { age: { $lte: 65 } }],
      ['findAllByCreatedAtAfter', [new Date('2024-01-01T00:00:00.000Z')], { createdAt: { $gt: new Date('2024-01-01T00:00:00.000Z') } }],
      ['findAllByCreatedAtBefore', [new Date('2024-01-01T00:00:00.000Z')], { createdAt: { $lt: new Date('2024-01-01T00:00:00.000Z') } }],
      ['findAllByAgeBetween', [18, 65], { age: { $gte: 18, $lte: 65 } }],
      ['findAllByStatusIn', [['active', 'pending']], { status: { $in: ['active', 'pending'] } }],
      ['findAllByStatusNotIn', [['archived']], { status: { $nin: ['archived'] } }],
      ['findAllByStatusIsNotIn', [['archived']], { status: { $nin: ['archived'] } }],
    ];

    for (const [methodName, args, where] of cases) {
      const plan = parseDerivedQueryMethod(ParserUser, methodName)!;

      expect(buildDerivedWhere(plan, args)).toEqual(where);
    }
  });

  test('parses every supported pattern, null, and boolean operator', () => {
    registerParserUser();

    const cases: Array<[string, unknown[], Record<string, any>]> = [
      ['findAllByNameLike', ['A%'], { name: { $like: 'A%' } }],
      ['findAllByNameNotLike', ['A%'], { name: { $notLike: 'A%' } }],
      ['findAllByNameContaining', ['li'], { name: { $like: '%li%' } }],
      ['findAllByNameContains', ['li'], { name: { $like: '%li%' } }],
      ['findAllByNameNotContaining', ['li'], { name: { $notLike: '%li%' } }],
      ['findAllByNameStartingWith', ['A'], { name: { $like: 'A%' } }],
      ['findAllByNameEndingWith', ['son'], { name: { $like: '%son' } }],
      ['findAllByDeletedAtIsNull', [], { deletedAt: null }],
      ['findAllByDeletedAtNull', [], { deletedAt: null }],
      ['findAllByDeletedAtIsNotNull', [], { deletedAt: { $ne: null } }],
      ['findAllByDeletedAtNotNull', [], { deletedAt: { $ne: null } }],
      ['findAllByActiveTrue', [], { active: true }],
      ['findAllByActiveIsTrue', [], { active: true }],
      ['findAllByActiveFalse', [], { active: false }],
      ['findAllByActiveIsFalse', [], { active: false }],
    ];

    for (const [methodName, args, where] of cases) {
      const plan = parseDerivedQueryMethod(ParserUser, methodName)!;

      expect(plan.parameterCount).toBe(args.length);
      expect(buildDerivedWhere(plan, args)).toEqual(where);
    }
  });

  test('parses multi-field OrderBy', () => {
    registerParserUser();

    const plan = parseDerivedQueryMethod(ParserUser, 'findAllByStatusOrderByActiveDescCreatedAtAsc')!;

    expect(plan.orderBy).toEqual({
      active: 'DESC',
      createdAt: 'ASC',
    });
  });
});
