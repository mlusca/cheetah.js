import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';

describe('Relation filters inside top-level OR conditions', () => {
  const DDL_NAVIGATION_NODE = `
    CREATE TABLE "navigation_node" (
      "id" SERIAL PRIMARY KEY,
      "code" varchar(255) NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true
    );
  `;

  const DDL_NAVIGATION_ROUTE = `
    CREATE TABLE "navigation_route" (
      "id" SERIAL PRIMARY KEY,
      "code" varchar(255) NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "first_node_id" integer REFERENCES "navigation_node" ("id"),
      "second_node_id" integer REFERENCES "navigation_node" ("id")
    );
  `;

  @Entity({ tableName: 'navigation_node' })
  class NavigationNode extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    code: string;

    @Property()
    isActive: boolean;
  }

  @Entity({ tableName: 'navigation_route' })
  class NavigationRoute extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    code: string;

    @Property()
    isActive: boolean;

    @ManyToOne(() => NavigationNode)
    firstNode: NavigationNode;

    @ManyToOne(() => NavigationNode)
    secondNode: NavigationNode;
  }

  class NavigationRouteRepository extends Repository<NavigationRoute> {
    constructor() {
      super(NavigationRoute);
    }
  }

  let routeRepository: NavigationRouteRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_NAVIGATION_NODE);
    await execute(DDL_NAVIGATION_ROUTE);
    routeRepository = new NavigationRouteRepository();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  const seedRoutes = async () => {
    const nodeA = await NavigationNode.create({ code: 'A', isActive: true });
    const nodeB = await NavigationNode.create({ code: 'B', isActive: true });
    const nodeC = await NavigationNode.create({ code: 'C', isActive: true });
    const nodeD = await NavigationNode.create({ code: 'D', isActive: true });

    await NavigationRoute.create({
      code: 'route-first-match',
      isActive: true,
      firstNode: nodeA,
      secondNode: nodeB,
    });

    await NavigationRoute.create({
      code: 'route-second-match',
      isActive: true,
      firstNode: nodeD,
      secondNode: nodeC,
    });

    await NavigationRoute.create({
      code: 'route-no-match',
      isActive: true,
      firstNode: nodeB,
      secondNode: nodeD,
    });

    await NavigationRoute.create({
      code: 'route-inactive',
      isActive: false,
      firstNode: nodeA,
      secondNode: nodeD,
    });

    return {
      nodeA,
      nodeB,
      nodeC,
      nodeD,
      nodeIds: [nodeA.id, nodeC.id],
    };
  };

  const getRouteCodes = (routes: NavigationRoute[]) =>
    routes.map(route => route.code);

  test('active record should combine top-level OR relation filters with scalar filters', async () => {
    const { nodeIds } = await seedRoutes();

    const routes = await NavigationRoute.find({
      $or: [
        { firstNode: { $in: nodeIds } },
        { secondNode: { $in: nodeIds } },
      ],
      isActive: true,
    }, {
      orderBy: { id: 'ASC' },
    });

    expect(getRouteCodes(routes)).toEqual([
      'route-first-match',
      'route-second-match',
    ]);
  });

  test('repository should combine top-level OR relation filters with scalar filters', async () => {
    const { nodeIds } = await seedRoutes();

    const routes = await routeRepository.find({
      where: {
        $or: [
          { firstNode: { $in: nodeIds } },
          { secondNode: { $in: nodeIds } },
        ],
        isActive: true,
      },
      orderBy: { id: 'ASC' },
    });

    expect(getRouteCodes(routes)).toEqual([
      'route-first-match',
      'route-second-match',
    ]);
  });

  test('active record should combine top-level AND relation filters with scalar filters', async () => {
    const { nodeA, nodeB } = await seedRoutes();

    const routes = await NavigationRoute.find({
      $and: [
        { firstNode: { $in: [nodeA.id, nodeB.id] } },
        { secondNode: { $eq: nodeB.id } },
      ],
      isActive: true,
    }, {
      orderBy: { id: 'ASC' },
    });

    expect(getRouteCodes(routes)).toEqual([
      'route-first-match',
    ]);
  });

  test('repository should support nested AND filters inside relation shorthand operators', async () => {
    const { nodeA, nodeB } = await seedRoutes();

    const routes = await routeRepository.find({
      where: {
        firstNode: {
          $and: [
            { $in: [nodeA.id, nodeB.id] },
            { $ne: nodeB.id },
          ],
        },
        isActive: true,
      },
      orderBy: { id: 'ASC' },
    });

    expect(getRouteCodes(routes)).toEqual([
      'route-first-match',
    ]);
  });

  test('repository should support nested OR filters inside relation shorthand operators', async () => {
    const { nodeB, nodeC } = await seedRoutes();

    const routes = await routeRepository.find({
      where: {
        secondNode: {
          $or: [
            { $eq: nodeB.id },
            { $eq: nodeC.id },
          ],
        },
        isActive: true,
      },
      orderBy: { id: 'ASC' },
    });

    expect(getRouteCodes(routes)).toEqual([
      'route-first-match',
      'route-second-match',
    ]);
  });
});
