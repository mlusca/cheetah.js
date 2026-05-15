# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.5.0](https://github.com/carnojs/carno.js/compare/v1.3.3...v1.5.0) (2026-05-15)


### Features

* add bulk delete, bulk update and bulk insert ([#39](https://github.com/carnojs/carno.js/issues/39)) ([85e211b](https://github.com/carnojs/carno.js/commit/85e211bff2e7ceb152723db7fbf2873539903127))





# [1.4.0](https://github.com/carnojs/carno.js/compare/v1.3.3...v1.4.0) (2026-05-15)


### Features

* add bulk delete, bulk update and bulk insert ([#39](https://github.com/carnojs/carno.js/issues/39)) ([85e211b](https://github.com/carnojs/carno.js/commit/85e211bff2e7ceb152723db7fbf2873539903127))





# Unreleased

### Performance

* **`Context.locals` lazy allocation**: `ctx.locals` is now allocated on first access via a getter, so handlers that never touch the per-request scratchpad skip an object allocation per request. Existing `ctx.locals.foo = ...` and `ctx.locals.foo` patterns are unchanged.

# [1.3.0](https://github.com/carnojs/carno.js/compare/v1.1.2...v1.3.0) (2026-03-07)


### Features

* Implement ManyToMany and OneToOne relationship decorators ([#26](https://github.com/carnojs/carno.js/issues/26)) ([f605c1d](https://github.com/carnojs/carno.js/commit/f605c1d863367bf312f152e44c3031bbb86a6a16))
* **websocket:** new package ([016d6c5](https://github.com/carnojs/carno.js/commit/016d6c598c789dc420e7bd98ef8e997ebfe04ee2))





# [1.2.0](https://github.com/carnojs/carno.js/compare/v1.1.2...v1.2.0) (2026-02-26)


### Features

* Add CompressionMiddleware for response compression and enhance middleware handling ([eba0f96](https://github.com/carnojs/carno.js/commit/eba0f96a0143eff7baf53d61c138fa8947f2865b))





## [1.0.8](https://github.com/carnojs/carno.js/compare/v1.0.7...v1.0.8) (2026-01-13)

**Note:** Version bump only for package @carno.js/core





# [1.0.0](https://github.com/carnojs/carno.js/compare/v0.2.11...v1.0.0) (2026-01-09)

**Note:** Version bump only for package @carno.js/core





# [1.0.0](https://github.com/carnojs/carno.js/compare/v0.2.11...v1.0.0) (2026-01-09)

**Note:** Version bump only for package @carno.js/core
