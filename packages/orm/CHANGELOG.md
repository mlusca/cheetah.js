# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.4.4](https://github.com/carnojs/carno.js/compare/v1.4.3...v1.4.4) (2026-06-29)


### Bug Fixes

* **orm:** array_column ([#49](https://github.com/carnojs/carno.js/issues/49)) ([ba4c01b](https://github.com/carnojs/carno.js/commit/ba4c01bd78427c1c217e7f3dc6e7e88480c8d9d1))





## [1.4.3](https://github.com/carnojs/carno.js/compare/v1.4.2...v1.4.3) (2026-06-26)


### Bug Fixes

* **core:** concurrency singleton ([#48](https://github.com/carnojs/carno.js/issues/48)) ([3651d7c](https://github.com/carnojs/carno.js/commit/3651d7c49092e4c9cce7e2bc1bee7ec8f9d69baa))





## [1.4.2](https://github.com/carnojs/carno.js/compare/v1.4.1...v1.4.2) (2026-06-19)


### Bug Fixes

* **sql:** enhance SQL safety ([#47](https://github.com/carnojs/carno.js/issues/47)) ([fbaa678](https://github.com/carnojs/carno.js/commit/fbaa678c57214ac7da8c616efb7061fe7e1d01ff))






## [1.4.1](https://github.com/carnojs/carno.js/compare/v1.3.3...v1.4.1) (2026-05-28)


### Features

* add bulk delete, bulk update and bulk insert ([#39](https://github.com/carnojs/carno.js/issues/39)) ([85e211b](https://github.com/carnojs/carno.js/commit/85e211bff2e7ceb152723db7fbf2873539903127))
* derived_queries ([#42](https://github.com/carnojs/carno.js/issues/42)) ([18ce0b7](https://github.com/carnojs/carno.js/commit/18ce0b7b27ad7c1bc8999f5c3e671ed5c27b4ef1))
* implement lifecycle hooks and add transactional support with @Transactional decorator ([#44](https://github.com/carnojs/carno.js/issues/44)) ([e7408d1](https://github.com/carnojs/carno.js/commit/e7408d1e2d0e432764f901b8eb4700543fc606cf))
* **orm:** add SharedConfig entity and repository with tenant context tests ([df02211](https://github.com/carnojs/carno.js/commit/df022118c647781af8012b930e522a105e360728))
* **orm:** add support for computed updates using expr() ([#34](https://github.com/carnojs/carno.js/issues/34)) ([0a6320f](https://github.com/carnojs/carno.js/commit/0a6320fe47343ed2b3333a2739f841fe40b2b2d1))





# [1.4.0](https://github.com/carnojs/carno.js/compare/v1.3.3...v1.4.0) (2026-05-28)


### Features

* add bulk delete, bulk update and bulk insert ([#39](https://github.com/carnojs/carno.js/issues/39)) ([85e211b](https://github.com/carnojs/carno.js/commit/85e211bff2e7ceb152723db7fbf2873539903127))
* derived_queries ([#42](https://github.com/carnojs/carno.js/issues/42)) ([18ce0b7](https://github.com/carnojs/carno.js/commit/18ce0b7b27ad7c1bc8999f5c3e671ed5c27b4ef1))
* implement lifecycle hooks and add transactional support with @Transactional decorator ([#44](https://github.com/carnojs/carno.js/issues/44)) ([e7408d1](https://github.com/carnojs/carno.js/commit/e7408d1e2d0e432764f901b8eb4700543fc606cf))
* **orm:** add SharedConfig entity and repository with tenant context tests ([df02211](https://github.com/carnojs/carno.js/commit/df022118c647781af8012b930e522a105e360728))
* **orm:** add support for computed updates using expr() ([#34](https://github.com/carnojs/carno.js/issues/34)) ([0a6320f](https://github.com/carnojs/carno.js/commit/0a6320fe47343ed2b3333a2739f841fe40b2b2d1))





# Unreleased

### Performance

* **Hot-path metadata cache** (`EntityMetadataIndex`): pre-computed Maps and arrays per entity replace `Object.entries(...).filter(...)` and `relations.find(...)` on every insert/update/select. CPU micro-benchmarks: `processForInsert` 2.31×, `processForUpdate` 1.77×, `createInstance` 2.09×, `getColumnName` 1.56×.
* **Loop fusion in hydration** (`ModelTransformer.transform`): three sequential trailing loops merged into a single `finalizeHydration` pass. Combined with the metadata cache, `findAll-with-join` is **~19% faster** on Postgres.
* **Join-order normalization O(n)**: `SqlBuilder.normalizeJoinOrder` rewritten as a Kahn-style topological sort with pre-computed dependency sets, replacing the previous O(n²) splice/regex-per-iteration loop.
* **Identity-map fast path**: `entity-key-generator` now caches `pkPropertyName` and `class.name` in `WeakMap`s.

### Features

* **Bulk insert** — `Repository.bulkCreate(rows, { chunkSize? })` and `BaseEntity.createMany(rows)` emit a single multi-row `INSERT ... VALUES (...), (...)` per chunk (default chunk size 500). Multi-chunk runs auto-wrap in a transaction. Per-row hooks (`@BeforeCreate`/`@AfterCreate`), `default`, and `onInsert` fire for every row. Driver layer handles ID resolution (PG `RETURNING`, MySQL `LAST_INSERT_ID()` + consecutive-ID inference). Measured speedups vs. sequential `create()`: **PG ~48×**, **MySQL ~114×** for 500 rows.
* **Bulk update** — `Repository.bulkUpdate(rows, { chunkSize? })` builds a single `UPDATE ... SET col = CASE pk WHEN ... THEN ... ELSE col END WHERE pk IN (...)` per chunk. Rows omitting a column keep their existing value (ELSE col). `onUpdate` properties (e.g. `updatedAt`) apply to every row. Returns total `affectedRows`. Speedups: **PG 71×**, **MySQL 182×**.
* **Bulk delete** — `Repository.bulkDelete(ids[], { chunkSize? })` emits chunked `DELETE WHERE pk IN (...)`. Speedups: **PG 53×**, **MySQL 94×**.
* **Session / Unit of Work** — new `Session` class and `withSession(cb)` helper (`@carno.js/orm`). Queue heterogeneous inserts/updates/deletes across multiple entity types, then `flush()` commits everything in one transaction with FK-safe topological order (parents-first inserts, reverse for deletes). Speedups for mixed parent/child graphs: **PG 57×**, **MySQL 106×**.
* **Driver API** — `DriverInterface.formatLiteral(value)` is now public and used by the bulk-update SQL builder. The bulk-insert codepath also exposes `Statement.bulk` and `Statement.instances` for drivers that need per-row hydration.

### Tests

* New correctness specs: `test/repository/bulk-operations.spec.ts` (7), `test/repository/bulk-update-delete.spec.ts` (10), `test/session/session-uow.spec.ts` (9). All green on Postgres and MySQL.
* New perf specs (with JSON baselines): `bulk-create.perf.spec.ts`, `bulk-update.perf.spec.ts`, `bulk-delete.perf.spec.ts`, `session-flush.perf.spec.ts`, `cpu-microbench.perf.spec.ts`, `baseline.perf.spec.ts`. Each suite asserts a minimum 5× speedup gate.

# [1.3.0](https://github.com/carnojs/carno.js/compare/v1.1.2...v1.3.0) (2026-03-07)


### Bug Fixes

* Increase cache expiration wait times for improved reliability ([#30](https://github.com/carnojs/carno.js/issues/30)) ([6929d60](https://github.com/carnojs/carno.js/commit/6929d60a96a3ee39fa223712e5acfed84cc6b209))


### Features

* Implement ManyToMany and OneToOne relationship decorators ([#26](https://github.com/carnojs/carno.js/issues/26)) ([f605c1d](https://github.com/carnojs/carno.js/commit/f605c1d863367bf312f152e44c3031bbb86a6a16))





# [1.2.0](https://github.com/carnojs/carno.js/compare/v1.1.2...v1.2.0) (2026-02-26)


### Features

* Add CompressionMiddleware for response compression and enhance middleware handling ([eba0f96](https://github.com/carnojs/carno.js/commit/eba0f96a0143eff7baf53d61c138fa8947f2865b))
* Implement ManyToMany and OneToOne relationship decorators ([f0eae30](https://github.com/carnojs/carno.js/commit/f0eae30a49f2ec354a8f9bcac62a582f1f0077f0))





## [1.0.8](https://github.com/carnojs/carno.js/compare/v1.0.7...v1.0.8) (2026-01-13)

**Note:** Version bump only for package @carno.js/orm





# [1.0.0](https://github.com/carnojs/carno.js/compare/v0.2.11...v1.0.0) (2026-01-09)

**Note:** Version bump only for package @carno.js/orm





# [1.0.0](https://github.com/carnojs/carno.js/compare/v0.2.11...v1.0.0) (2026-01-09)

**Note:** Version bump only for package @carno.js/orm






## [0.2.9](https://github.com/carnojs/carno.js/compare/v0.2.8...v0.2.9) (2026-01-03)

**Note:** Version bump only for package @carno.js/orm
