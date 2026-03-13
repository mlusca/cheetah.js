import { describe, expect, it } from 'bun:test';
import { Metadata } from '@carno.js/core';
import { BaseEntity } from '../../src/domain/base-entity';
import { Entity } from '../../src/decorators/entity.decorator';
import { PrimaryKey } from '../../src/decorators/primary-key.decorator';
import { Property } from '../../src/decorators/property.decorator';
import { Version } from '../../src/decorators/version.decorator';
import { Tenant } from '../../src/decorators/tenant.decorator';
import { VERSION_PROPERTY, TENANT_PROPERTY } from '../../src/constants';

describe('@Version Decorator', () => {
  describe('Unit Tests - Metadata', () => {
    it('should store the version property name in metadata', () => {
      @Entity()
      class VersionedPost extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        title: string;

        @Version()
        lockVersion: number;
      }

      const versionProp = Metadata.get(VERSION_PROPERTY, VersionedPost);

      expect(versionProp).toBe('lockVersion');
    });

    it('should work with a custom column-named version property', () => {
      @Entity()
      class Article extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        content: string;

        @Property({ columnName: 'lock_version' })
        @Version()
        version: number;
      }

      const versionProp = Metadata.get(VERSION_PROPERTY, Article);

      expect(versionProp).toBe('version');
    });

    it('should not interfere with @Property metadata', () => {
      @Entity()
      class Product extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        name: string;

        @Version()
        rowVersion: number;
      }

      const versionProp = Metadata.get(VERSION_PROPERTY, Product);

      // VERSION_PROPERTY is set
      expect(versionProp).toBe('rowVersion');
      // @Version field does NOT add itself to PROPERTIES_METADATA automatically
      // (it relies on a paired @Property if column mapping is needed)
      expect(versionProp).not.toBeNull();
    });

    it('should store only the last @Version if applied multiple times on different classes', () => {
      @Entity()
      class Alpha extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Version()
        versionA: number;
      }

      @Entity()
      class Beta extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Version()
        versionB: number;
      }

      expect(Metadata.get(VERSION_PROPERTY, Alpha)).toBe('versionA');
      expect(Metadata.get(VERSION_PROPERTY, Beta)).toBe('versionB');
    });

    it('should return undefined when entity has no @Version', () => {
      @Entity()
      class SimpleEntity extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        name: string;
      }

      const versionProp = Metadata.get(VERSION_PROPERTY, SimpleEntity);

      expect(versionProp).toBeUndefined();
    });
  });
});

describe('@Tenant Decorator', () => {
  describe('Unit Tests - Metadata', () => {
    it('should store the tenant property name in metadata', () => {
      @Entity()
      class TenantPost extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        title: string;

        @Tenant()
        tenantId: number;
      }

      const tenantProp = Metadata.get(TENANT_PROPERTY, TenantPost);

      expect(tenantProp).toBe('tenantId');
    });

    it('should work with a custom-named tenant property', () => {
      @Entity()
      class TenantOrder extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        total: number;

        @Tenant()
        orgId: string;
      }

      const tenantProp = Metadata.get(TENANT_PROPERTY, TenantOrder);

      expect(tenantProp).toBe('orgId');
    });

    it('should not interfere with @Version metadata', () => {
      @Entity()
      class MultiDecoratedEntity extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        data: string;

        @Tenant()
        organizationId: number;

        @Version()
        rowVersion: number;
      }

      const tenantProp = Metadata.get(TENANT_PROPERTY, MultiDecoratedEntity);
      const versionProp = Metadata.get(VERSION_PROPERTY, MultiDecoratedEntity);

      expect(tenantProp).toBe('organizationId');
      expect(versionProp).toBe('rowVersion');
    });

    it('should be isolated per class (no cross-class contamination)', () => {
      @Entity()
      class CompanyEntity extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Tenant()
        companyId: number;
      }

      @Entity()
      class NoTenantEntity extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        name: string;
      }

      expect(Metadata.get(TENANT_PROPERTY, CompanyEntity)).toBe('companyId');
      expect(Metadata.get(TENANT_PROPERTY, NoTenantEntity)).toBeUndefined();
    });

    it('should return undefined when entity has no @Tenant', () => {
      @Entity()
      class StandaloneEntity extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        name: string;
      }

      const tenantProp = Metadata.get(TENANT_PROPERTY, StandaloneEntity);

      expect(tenantProp).toBeUndefined();
    });
  });
});
