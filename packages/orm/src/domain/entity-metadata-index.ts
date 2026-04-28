import type { Relationship } from '../driver/driver.interface';
import type { PropertyOptions } from '../decorators/property.decorator';

/**
 * Entry indexed for fast iteration. `columnName` is the resolved DB column name
 * (already snake_cased / overridden by user).
 */
export type IndexedProperty = {
  key: string;
  columnName: string;
  options: PropertyOptions;
  type: Function;
};

/** Reverse lookup result for column → property. */
export type PropertyByColumn = {
  key: string;
  property: { options: PropertyOptions; type: Function } | { columnName: string; type: Function; relation: string; propertyKey: string | symbol; entity?: any };
};

/**
 * Pre-computed metadata derived from `Options.properties` and `Options.relations`.
 *
 * Built once per entity at registration time inside `EntityStorage.add()`.
 * Avoids per-row `Object.entries(...).filter(...)` and `relations.find(...)`
 * calls on hot insert/update/select paths.
 */
export type EntityMetadataIndex = {
  /** propertyKey -> DB column. Includes relation columns (many-to-one, one-to-one-owner). */
  columnByProperty: Map<string, string>;

  /** DB column -> { key, property } reverse lookup (used to hydrate result rows). */
  propertyByColumn: Map<string, PropertyByColumn>;

  /** propertyKey -> relation, only for *owning* relations (where the FK column lives). */
  owningRelationByProperty: Map<string, Relationship<any>>;

  /** All persisted properties (array form, in declaration order). */
  allProperties: IndexedProperty[];

  /** Subset with `options.default` set. */
  defaultProperties: IndexedProperty[];

  /** Subset with `options.onInsert` set. */
  onInsertProperties: IndexedProperty[];

  /** Subset with `options.onUpdate` set. */
  onUpdateProperties: IndexedProperty[];

  /** Many-to-one relations as array (used by `createInstance`). */
  manyToOneRelations: Relationship<any>[];
};

export function buildEntityMetadataIndex(
  properties: { [key: string]: { options: PropertyOptions; type: Function } },
  relations: Relationship<any>[],
): EntityMetadataIndex {
  const columnByProperty = new Map<string, string>();
  const propertyByColumn = new Map<string, PropertyByColumn>();
  const owningRelationByProperty = new Map<string, Relationship<any>>();
  const allProperties: IndexedProperty[] = [];
  const defaultProperties: IndexedProperty[] = [];
  const onInsertProperties: IndexedProperty[] = [];
  const onUpdateProperties: IndexedProperty[] = [];
  const manyToOneRelations: Relationship<any>[] = [];

  for (const key in properties) {
    const property = properties[key];
    const columnName = property.options.columnName || key;
    columnByProperty.set(key, columnName);

    const indexed: IndexedProperty = { key, columnName, options: property.options, type: property.type };
    allProperties.push(indexed);
    propertyByColumn.set(columnName, { key, property });

    if (property.options.default !== undefined && property.options.default !== null) {
      defaultProperties.push(indexed);
    }
    if (property.options.onInsert) {
      onInsertProperties.push(indexed);
    }
    if (property.options.onUpdate) {
      onUpdateProperties.push(indexed);
    }
  }

  if (relations) {
    for (const relation of relations) {
      const propKey = String(relation.propertyKey);
      if (relation.columnName) {
        columnByProperty.set(propKey, relation.columnName);

        // Reverse lookup is only meaningful for relations whose FK lives on this entity.
        if (relation.relation === 'many-to-one' || relation.relation === 'one-to-one-owner') {
          // Avoid clobbering a real property with the same column (shouldn't happen,
          // but be defensive — first wins).
          if (!propertyByColumn.has(relation.columnName)) {
            propertyByColumn.set(relation.columnName, { key: propKey, property: relation as any });
          }
        }
      }
      if (relation.relation === 'many-to-one' || relation.relation === 'one-to-one-owner') {
        owningRelationByProperty.set(propKey, relation);
      }
      if (relation.relation === 'many-to-one') {
        manyToOneRelations.push(relation);
      }
    }
  }

  return {
    columnByProperty,
    propertyByColumn,
    owningRelationByProperty,
    allProperties,
    defaultProperties,
    onInsertProperties,
    onUpdateProperties,
    manyToOneRelations,
  };
}
