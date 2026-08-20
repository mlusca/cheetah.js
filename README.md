<p align="center">
  <img src="carno.png" width="160" alt="Carno.js logo" />
</p>

<h1 align="center">Carno.js</h1>

<p align="center">
  <strong>An opinionated application framework and ORM ecosystem for Bun and TypeScript.</strong>
</p>

<p align="center">
  <a href="https://carnojs.github.io/carno.js/docs/intro">Documentation</a>
  ·
  <a href="https://carnojs.github.io/carno.js/docs/installation">Getting started</a>
  ·
  <a href="https://github.com/carnojs/carno.js">GitHub</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-native-black?style=flat-square&logo=bun" alt="Bun native" />
  <img src="https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript first" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
</p>

## Overview

Carno.js is an opinionated application framework for Bun, shaped for teams that want the familiar structure of NestJS and the enterprise patterns popularized by Spring in the Java ecosystem.

It combines a fast Bun-native HTTP core, dependency injection, decorators, validation, middleware, lifecycle hooks, and optional packages for data access, queues, scheduling, static files, WebSockets, and logging. The goal is to keep applications organized as they grow, with clear boundaries between controllers, services, modules, and infrastructure.

This repository is the monorepo for the Carno.js ecosystem. The README is intentionally concise; feature guides, examples, and API details live in the documentation site.

## Why Carno.js

- **Enterprise-oriented structure:** controllers, services, lifecycle hooks, modules, and dependency injection are first-class patterns for maintainable applications.
- **Inspired by proven ecosystems:** brings a NestJS-like developer experience and Spring-style application architecture to Bun and TypeScript.
- **Fast by design:** built around Bun's runtime and HTTP server, keeping performance intrinsic without making your architecture disposable.
- **TypeScript first:** decorators, typed controllers, dependency injection, and DTO validation are core concepts.
- **Modular by default:** install only the packages your application needs.
- **Application-ready:** includes packages for ORM, queues, scheduling, static assets, WebSockets, testing, and logging.

## Packages

| Package | Purpose |
| :--- | :--- |
| `@carno.js/core` | HTTP framework, routing, dependency injection, middleware, validation, lifecycle hooks, and testing utilities. |
| `@carno.js/orm` | Lightweight SQL ORM for PostgreSQL and MySQL, including repositories, query builder, relationships, migrations, identity map, and sessions. |
| `@carno.js/queue` | Background job processing built around BullMQ. |
| `@carno.js/schedule` | Cron, interval, and timeout scheduling. |
| `@carno.js/static` | Static file serving for Bun applications. |
| `@carno.js/websocket` | WebSocket gateways, rooms, namespaces, and broadcasting. |
| `@carno.js/logger` | Logging utilities for Carno.js applications. |
| `@carno.js/client` | Type-safe HTTP client generated from controllers. |
| `@carno.js/cli` | Command-line tools, including ORM migration workflows. |

## Getting Started

Install the core package:

```bash
bun install @carno.js/core
```

On Windows, wrap scoped package names in quotes:

```bash
bun install "@carno.js/core"
```

Then follow the full setup guide in the documentation:

[Installation and setup](https://carnojs.github.io/carno.js/docs/installation)

## Documentation

The documentation site is the source of truth for usage examples and API guidance:

- [Introduction](https://carnojs.github.io/carno.js/docs/intro)
- [Coming from NestJS](https://carnojs.github.io/carno.js/docs/coming-from-nestjs)
- [Core framework](https://carnojs.github.io/carno.js/docs/core/overview)
- [ORM](https://carnojs.github.io/carno.js/docs/orm/overview)
- [Queue](https://carnojs.github.io/carno.js/docs/queue/overview)
- [Schedule](https://carnojs.github.io/carno.js/docs/schedule/overview)
- [Static files](https://carnojs.github.io/carno.js/docs/static/overview)
- [WebSocket](https://carnojs.github.io/carno.js/docs/websocket/overview)
- [Testing](https://carnojs.github.io/carno.js/docs/testing/overview)

## Repository Workflow

Install dependencies:

```bash
bun install
```

Run the TypeScript build:

```bash
npm run build
```

Run tests:

```bash
bun test
```

Run ORM tests against PostgreSQL or MySQL:

```bash
npm run test:postgres
npm run test:mysql
```

## Documentation Site

The site is built with Docusaurus and lives in `docs/carno`.

```bash
cd docs/carno
npm install
npm run start
```

Use the site for new guides, examples, and API explanations. Keep this README focused on project positioning, package discovery, and contributor orientation.

## Contributing

Issues, pull requests, bug reports, and documentation improvements are welcome. Before opening a large change, prefer starting with an issue or discussion so the scope and expected behavior are clear.

## License

Carno.js is released under the MIT License. See [LICENSE](LICENSE) for details.
