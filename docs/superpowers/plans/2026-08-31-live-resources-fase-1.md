# Live Resources — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo de `@carno.js/live` — um `@Get()` marcado com `@Live()` vira uma subscrição sobre WebSocket que se atualiza sozinha quando o ORM escreve na tabela de que ela depende.

**Architecture:** Um pacote novo `@carno.js/live` com quatro estruturas de dados puras (grafo de dependência, registry de subscrições, motor de patch, canonicalização/hash) mais duas peças de I/O (registry de resources, transporte). O ORM ganha um observador de `Statement` de uma linha em `SqlBuilder.execute()`, que alimenta a coleta de dependência na leitura e a emissão de invalidação na escrita. O cliente é um núcleo agnóstico que expõe a interface de `useSyncExternalStore`, com um adapter React de poucas linhas por cima.

**Tech Stack:** Bun, TypeScript 5.9, decorators legacy (`experimentalDecorators`), `reflect-metadata`, `AsyncLocalStorage`, `bun:test`, `@carno.js/core`, `@carno.js/websocket`, `@carno.js/orm`.

**Spec:** [`docs/superpowers/specs/2026-08-31-live-resources-design.md`](../specs/2026-08-31-live-resources-design.md) — este plano implementa a **Fase 1** da §13. Leia a spec antes de começar; o plano argumenta a partir dela.

## Global Constraints

- **Runtime:** Bun. Nenhum uso de API exclusiva de Node além de `async_hooks` (já usado em `packages/orm/src/transaction/transaction-context.ts`).
- **TypeScript:** herda `tsconfig.json` da raiz — `module: CommonJS`, `target: ES2021`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strictPropertyInitialization: false`.
- **Indentação:** 4 espaços em `packages/live` e `packages/core` (segue `packages/core`, `packages/websocket`); **2 espaços** em `packages/orm` (segue `packages/orm/src/SqlBuilder.ts`). Aspas simples, ponto e vírgula, em todos.
- **Testes:** `bun test`. Import de `bun:test` (`describe`, `test`, `expect`). Arquivos em `packages/live/test/**/*.test.ts`.
- **Dependências:** zero dependências de runtime novas. `@carno.js/core` e `@carno.js/websocket` são `peerDependencies`; `react` é peer opcional.
- **Código e comentários em inglês; documentação em português.** É o padrão do repositório.
- **Defaults de configuração** (§10.1 da spec, valores exatos): `coalesceMs: 16`, `maxKeysPerRead: 64`, `maxInputBytes: 8192`, `unsubGraceMs: 5000`, `maxPendingPatches: 32`, `fanoutQueueThreshold: 500`, `maxInstancesPerConnection: 64`, `maxInstancesPerNode: 50000`.
- **Branch:** criar `feat/live-resources-fase-1` a partir de `docs/live-resources-design` antes da Task 1.
- **Commits:** toda mensagem termina com o trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Desvios deliberados da spec

Quatro pontos onde a implementação se afasta do texto da spec. Cada um é uma correção, não uma simplificação, e o motivo está registrado aqui para o revisor poder discordar.

**1. `instanceId` não hasheia o escopo junto com os inputs.** A spec (§4.1) define
`instanceId = hash(resourceId + canonical(inputs) + scopeHash)`. Isso põe a
isolação entre tenants na dependência de não haver colisão de hash — e uma
colisão aí não custa CPU, mostra o dado de um tenant para outro (critério de
aceite 8). A implementação usa uma chave **estruturada**:

```
instanceId = `${resourceId}|${scopeKey}|${fnv1a64(canonical(inputs))}`
```

com `scopeKey` literal (`pub`, `t:<tenant>`, `p:<principal>`, URL-encoded). O
escopo nunca passa por hash, então nenhuma colisão pode fundir dois tenants. Só
os inputs são hasheados, e ali uma colisão degrada como a do cache do ORM.

**2. Hash de 64 bits, não 32.** A spec manda reusar o FNV-1a de
`packages/orm/src/cache/cache-key-generator.ts`. Aquele é de 32 bits: a 50% de
chance de colisão em ~65 mil chaves, contra um `maxInstancesPerNode` de 50 mil.
Para cache uma colisão custa uma entrada velha; aqui custa um patch não enviado.
Implementamos `fnv1a64` (duas pistas de 32 bits) no mesmo estilo. É mais fraco que
um hash criptográfico e vive num módulo só, para poder ser trocado sem tocar em
mais nada.

**3. `@Header()` e `@Locals()` também são proibidos em live resource.** A spec
(§5.6) proíbe `@Req()` e `@Ctx()`. Headers e locals vêm do `Request` e da cadeia
de middleware, que não existem num recompute — quebram D4 pelo mesmo motivo.
Proibimos os quatro.

**4. Escopo sim, autorização contínua não — nesta fase.** §5.4 (principal como
dependência do grafo, `auth:user#42`) e a reexecução da cadeia de
middleware/guard exigem replay de middleware sobre WebSocket. A §13 não coloca
isso na Fase 1, e o critério 8 é sobre **escopo**, que esta fase entrega. O
default privado por conexão é seguro por construção: sem um `LiveScopeResolver`
plugado, cada conexão é seu próprio principal e nada é compartilhado. §5.4 fica
para a Fase 2, e o plano dela deve começar por aí.

Três comportamentos que a spec não trata e que aparecem na implementação:

- **Rolled-back writes do not invalidate.** `notifyWrite()` records the statement
  while the transaction is open, and `Orm.transaction()` releases the queue only
  after the driver confirms the commit. On an error or rollback, the queue is
  discarded before any recompute, so no uncommitted patch reaches the client.
- **Leitura com cache-hit do ORM precisa registrar dependência.** `execute()`
  retorna cedo no cache-hit. Se o hook ficasse depois disso, um resource cujo
  primeiro compute pegou cache nunca seria invalidado. O hook de leitura vai
  **antes** do `shouldUseCache()`.
- **Backpressure é aproximado por retorno de `send()`.** `Bun.ServerWebSocket.send()`
  devolve `-1` sob backpressure. Contamos envios consecutivos não-positivos por
  conexão; passando de `maxPendingPatches`, mandamos snapshot e zeramos. É a
  aproximação de Fase 1 da regra 3 da §4.5, que fala em "patches acumulados".

## Limitação conhecida do core (não corrigida nesta fase)

`Carno.use()` guarda **um único** `_wsHandlerBuilder` (`packages/core/src/Carno.ts:175-178`):
um segundo plugin de WebSocket sobrescreve o primeiro, enquanto os
`_wsUpgradePaths` acumulam. O resultado é um upgrade que dá certo e cai num
gateway inexistente, em silêncio. Por isso `LivePlugin.create()` recebe os
gateways da aplicação e monta **um** `WebSocketPlugin` com todos eles. Consertar o
core (lista de builders em vez de slot único) é trabalho separado e não entra aqui.

## File Structure

**Pacote novo `packages/live/`:**

| Arquivo | Responsabilidade |
| :--- | :--- |
| `package.json`, `tsconfig.json` | Manifesto do pacote |
| `src/index.ts` | Superfície pública do servidor |
| `src/config.ts` | `LiveConfig` + defaults da §10.1 |
| `src/metadata.ts` | `LIVE_META`, `LiveOptions`, `LiveMeta` |
| `src/decorators/Live.ts` | `@Live()` |
| `src/shared/canonical.ts` | Canonicalização de JSON (cliente **e** servidor) |
| `src/shared/hash.ts` | `fnv1a64` (cliente **e** servidor) |
| `src/shared/protocol.ts` | Tipos das mensagens (cliente **e** servidor) |
| `src/graph/dep-key.ts` | `DepKey`, ancestrais |
| `src/graph/types.ts` | `Dependency`, `InvalidationEvent` |
| `src/graph/DependencyGraph.ts` | chave ↔ instância, filtro por coluna |
| `src/graph/SubscriptionRegistry.ts` | instância ↔ conexão, refcount |
| `src/patch/types.ts` | `PatchOp` |
| `src/patch/PatchEngine.ts` | `diff` / `apply` com chave e compartilhamento estrutural |
| `src/resource/types.ts` | `LiveInputs`, `LiveScope`, `LiveResource` |
| `src/resource/instance-id.ts` | `scopeKeyOf`, `instanceIdOf` |
| `src/resource/dependency-context.ts` | `AsyncLocalStorage` de coleta |
| `src/resource/ResourceRegistry.ts` | registro, validação, compute |
| `src/bus/InvalidationBus.ts` | interface |
| `src/bus/InProcessBus.ts` | implementação em processo |
| `src/emitters/statement-keys.ts` | `Statement` → dependências / eventos |
| `src/emitters/AppEmitter.ts` | liga o observador do ORM ao bus |
| `src/LiveEngine.ts` | coalescing, single-flight, recompute → patch |
| `src/LiveService.ts` | `invalidate()` público |
| `src/transport/LiveGateway.ts` | `@Gateway('/live')` |
| `src/LivePlugin.ts` | montagem |
| `src/client/core.ts` | `LiveClient`, `LiveStore` |
| `src/client/react.ts` | `useLive`, `LiveProvider` |

**Pacotes existentes:**

| Arquivo | Mudança |
| :--- | :--- |
| `packages/orm/src/live/statement-observer.ts` | **criar** — pub/sub puro de `Statement` |
| `packages/orm/src/SqlBuilder.ts` | **modificar** `execute()` |
| `packages/orm/src/index.ts` | **modificar** — exportar o observador |
| `tsconfig.json` (raiz) | **modificar** — `paths` + `references` |

---

### Task 1: Scaffold do pacote e primitivas compartilhadas

Canonicalização e hash são o alicerce: `instanceId`, hash de conteúdo e o
handshake dependem de cliente e servidor produzirem exatamente a mesma string. É
a primeira coisa e é puro.

**Files:**
- Create: `packages/live/package.json`
- Create: `packages/live/tsconfig.json`
- Create: `packages/live/src/shared/canonical.ts`
- Create: `packages/live/src/shared/hash.ts`
- Create: `packages/live/src/index.ts`
- Modify: `tsconfig.json` (raiz) — bloco `paths` e array `references`
- Test: `packages/live/test/shared.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `canonical(value: unknown, path?: string): string`
  - `class NonSerializableInputError extends Error { path: string; received: string }`
  - `fnv1a64(input: string): string` — sempre 16 caracteres hex.

- [ ] **Step 1: Criar a branch de trabalho**

```bash
git checkout -b feat/live-resources-fase-1
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `packages/live/test/shared.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { canonical, NonSerializableInputError } from '../src/shared/canonical';
import { fnv1a64 } from '../src/shared/hash';

describe('canonical', () => {
    test('orders object keys so equal inputs produce equal strings', () => {
        expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
        expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    test('preserves array order', () => {
        expect(canonical([3, 1, 2])).toBe('[3,1,2]');
    });

    test('drops undefined properties but keeps null', () => {
        expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
    });

    test('normalizes negative zero', () => {
        expect(canonical(-0)).toBe(canonical(0));
    });

    test('rejects non-serializable inputs', () => {
        expect(() => canonical(new Date())).toThrow(NonSerializableInputError);
        expect(() => canonical({ a: () => 1 })).toThrow(NonSerializableInputError);
        expect(() => canonical(Number.NaN)).toThrow(NonSerializableInputError);
    });

    test('reports the path of the offending value', () => {
        try {
            canonical({ filters: [{ since: new Date() }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as NonSerializableInputError).path).toBe('$.filters[0].since');
        }
    });
});

describe('fnv1a64', () => {
    test('is deterministic and 16 hex chars wide', () => {
        const hash = fnv1a64('carno');
        expect(hash).toMatch(/^[0-9a-f]{16}$/);
        expect(fnv1a64('carno')).toBe(hash);
    });

    test('separates inputs that differ only by order', () => {
        expect(fnv1a64('ab')).not.toBe(fnv1a64('ba'));
    });

    test('separates the empty string from a zero byte', () => {
        expect(fnv1a64('')).not.toBe(fnv1a64(String.fromCharCode(0)));
    });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/shared.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/canonical'`

- [ ] **Step 4: Criar o manifesto do pacote**

`packages/live/package.json`:

```json
{
  "name": "@carno.js/live",
  "version": "1.7.0",
  "description": "Server-owned reactive state for Carno.js: live resources, dependency-graph invalidation, and framework-native client stores",
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client/core.d.ts",
      "require": "./dist/client/core.js",
      "default": "./dist/client/core.js"
    },
    "./react": {
      "types": "./dist/client/react.d.ts",
      "require": "./dist/client/react.js",
      "default": "./dist/client/react.js"
    }
  },
  "scripts": {
    "compile": "rm -rf ./dist tsconfig.tsbuildinfo && tsc --build --force",
    "build": "tsc --build --force",
    "test": "bun test",
    "prepublishOnly": "bun run build"
  },
  "peerDependencies": {
    "@carno.js/core": "^1.7.0",
    "@carno.js/orm": "^1.7.0",
    "@carno.js/websocket": "^1.7.0",
    "react": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "@carno.js/orm": { "optional": true },
    "react": { "optional": true }
  },
  "keywords": ["carno", "carno.js", "live", "realtime", "reactive", "websocket"],
  "license": "MIT",
  "publishConfig": { "access": "public" }
}
```

`packages/live/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"],
  "references": [
    { "path": "../core" },
    { "path": "../orm" },
    { "path": "../websocket" }
  ],
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  }
}
```

- [ ] **Step 5: Registrar o pacote no tsconfig da raiz**

Em `tsconfig.json`, dentro de `compilerOptions.paths`, logo após o bloco `"@carno.js/views/*"`, acrescentar:

```json
      "@carno.js/live": [
        "./packages/live"
      ],
      "@carno.js/live/*": [
        "./packages/live/src/*"
      ]
```

E no array `references`, após `{ "path": "./packages/views" }`, acrescentar:

```json
    {
      "path": "./packages/live"
    }
```

- [ ] **Step 6: Implementar `canonical`**

`packages/live/src/shared/canonical.ts`:

```ts
/**
 * Deterministic JSON canonicalization, shared verbatim by client and server.
 *
 * Both sides MUST produce byte-identical output for the same logical value:
 * the instance id and the content hash are derived from it, so a divergence
 * silently breaks subscription dedupe and the hydration handshake instead of
 * failing loudly.
 */
export class NonSerializableInputError extends Error {
    constructor(
        public readonly path: string,
        public readonly received: string
    ) {
        super(`Live input at "${path}" is not serializable (received ${received}).`);
        this.name = 'NonSerializableInputError';
    }
}

export function canonical(value: unknown, path: string = '$'): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) {
                throw new NonSerializableInputError(path, String(value));
            }
            // -0 and 0 are the same input as far as a query is concerned.
            return Object.is(value, -0) ? '0' : String(value);
        case 'string':
            return JSON.stringify(value);
        case 'bigint':
        case 'function':
        case 'symbol':
            throw new NonSerializableInputError(path, typeof value);
    }

    if (Array.isArray(value)) {
        const items = value.map((item, index) => canonical(item, `${path}[${index}]`));
        return `[${items.join(',')}]`;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        // Date, Map, Set, class instances: no agreed wire form, so refuse
        // rather than guess one the client would canonicalize differently.
        const name = (value as object).constructor?.name ?? 'object';
        throw new NonSerializableInputError(path, name);
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    const body = entries
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, `${path}.${key}`)}`)
        .join(',');

    return `{${body}}`;
}
```

- [ ] **Step 7: Implementar `fnv1a64`**

`packages/live/src/shared/hash.ts`:

```ts
const FNV_OFFSET_BASIS_A = 2166136261;
const FNV_OFFSET_BASIS_B = 0x9e3779b9;
const FNV_PRIME = 16777619;

/**
 * FNV-1a widened to 64 output bits by running two lanes with different offset
 * bases, the second one position-sensitive.
 *
 * `packages/orm/src/cache/cache-key-generator.ts` uses the 32-bit variant,
 * which is right for a cache — a collision there costs one stale entry. Here a
 * content-hash collision means "data changed but no patch was sent", and 32
 * bits reach 50% collision odds around 65k keys while `maxInstancesPerNode`
 * alone is 50000. This lives in one module so it can be swapped for a stronger
 * hash without touching anything else.
 */
export function fnv1a64(input: string): string {
    let laneA = FNV_OFFSET_BASIS_A;
    let laneB = FNV_OFFSET_BASIS_B;

    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);

        laneA ^= code;
        laneA = Math.imul(laneA, FNV_PRIME);

        laneB ^= code + i;
        laneB = Math.imul(laneB, FNV_PRIME);
    }

    return (laneA >>> 0).toString(16).padStart(8, '0') + (laneB >>> 0).toString(16).padStart(8, '0');
}
```

- [ ] **Step 8: Criar o barrel provisório**

`packages/live/src/index.ts`:

```ts
export { canonical, NonSerializableInputError } from './shared/canonical';
export { fnv1a64 } from './shared/hash';
```

- [ ] **Step 9: Rodar o teste e ver passar**

Run: `bun test packages/live/test/shared.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 10: Verificar que o build da raiz continua limpo**

Run: `npx tsc -b -v --pretty false --force`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add packages/live tsconfig.json
git commit -m "$(cat <<'EOF'
feat(live): scaffold @carno.js/live with canonical JSON and fnv1a64

Canonicalization and hashing are shared verbatim by client and server:
instance identity and the content-hash handshake both derive from them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `DepKey` e derivação de chaves a partir de `Statement`

Traduz o vocabulário do ORM para o vocabulário do grafo. É a peça que decide se a
invalidação é fina (`orm:users#42`) ou grossa (`orm:users`), e a regra é a da
§4.3: **correção ganha de precisão** — o que não dá para provar degrada para o
ancestral, nunca para chave nenhuma.

**Files:**
- Create: `packages/live/src/graph/dep-key.ts`
- Create: `packages/live/src/graph/types.ts`
- Create: `packages/live/src/config.ts`
- Create: `packages/live/src/emitters/statement-keys.ts`
- Test: `packages/live/test/statement-keys.test.ts`

**Interfaces:**
- Consumes: `Statement<T>` de `@carno.js/orm` (`packages/orm/src/driver/driver.interface.ts:232`).
- Produces:
  - `type DepKey = string`
  - `tableKey(table: string): DepKey`, `rowKey(table: string, id: string | number): DepKey`
  - `ancestorsOf(key: DepKey): DepKey[]`
  - `interface Dependency { key: DepKey; columns: string[] | null }`
  - `interface InvalidationEvent { key: DepKey; columns: string[] | null }`
  - `readDependencies(statement, maxKeysPerRead): Dependency[]`
  - `writeEvents(statement, maxKeysPerRead): InvalidationEvent[]`
  - `normalizeColumns(columns: string[] | undefined): string[] | null`
  - `interface LiveConfig`, `DEFAULT_LIVE_CONFIG`

`columns: null` significa **curinga**: casa com qualquer coluna. Um `DELETE`
emite curinga porque apaga a linha inteira; um `SELECT *` depende de tudo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/statement-keys.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Statement } from '@carno.js/orm';
import { ancestorsOf, rowKey, tableKey } from '../src/graph/dep-key';
import { normalizeColumns, readDependencies, writeEvents } from '../src/emitters/statement-keys';

const MAX = 64;

function select(overrides: Partial<Statement<any>>): Statement<any> {
    return { statement: 'select', table: 'users', alias: 'u', primaryKeyColumnName: 'id', ...overrides };
}

describe('dep-key', () => {
    test('builds table and row keys', () => {
        expect(tableKey('users')).toBe('orm:users');
        expect(rowKey('users', 42)).toBe('orm:users#42');
    });

    test('a row key has its table as ancestor', () => {
        expect(ancestorsOf('orm:users#42')).toEqual(['orm:users#42', 'orm:users']);
    });

    test('a table key has only itself', () => {
        expect(ancestorsOf('orm:users')).toEqual(['orm:users']);
    });

    test('an arbitrary app key is not split on colons', () => {
        expect(ancestorsOf('app:report:2026-08')).toEqual(['app:report:2026-08']);
    });
});

describe('normalizeColumns', () => {
    test('strips alias, quotes and the AS clause the ORM generates', () => {
        expect(normalizeColumns(['u."name" as "u_name"', 'u."id" as "u_id"'])).toEqual(['id', 'name']);
    });

    test('treats a star select as wildcard', () => {
        expect(normalizeColumns(['*'])).toBeNull();
        expect(normalizeColumns(undefined)).toBeNull();
    });
});

describe('readDependencies', () => {
    test('a primary-key lookup depends on the row', () => {
        const deps = readDependencies(select({ where: 'u."id" = 42', columns: ['u."name" as "u_name"'] }), MAX);
        expect(deps).toEqual([{ key: 'orm:users#42', columns: ['name'] }]);
    });

    test('a filtered list depends on the table', () => {
        const deps = readDependencies(select({ where: "u.\"status\" = 'active'", columns: ['u."id" as "u_id"'] }), MAX);
        expect(deps).toEqual([{ key: 'orm:users', columns: ['id'] }]);
    });

    test('an IN list produces one row key per id', () => {
        const deps = readDependencies(select({ where: 'u."id" IN (1, 2, 3)' }), MAX);
        expect(deps.map(d => d.key)).toEqual(['orm:users#1', 'orm:users#2', 'orm:users#3']);
    });

    test('collapses to the table when the IN list exceeds maxKeysPerRead', () => {
        const ids = Array.from({ length: 5 }, (_, i) => i + 1).join(', ');
        const deps = readDependencies(select({ where: `u."id" IN (${ids})` }), 4);
        expect(deps.map(d => d.key)).toEqual(['orm:users']);
    });

    test('a join adds the joined table as its own dependency', () => {
        const statement = select({
            where: 'u."id" = 7',
            join: [{ joinTable: 'orders', joinAlias: 'o', type: 'INNER', on: 'o.user_id = u.id' } as any]
        });
        expect(readDependencies(statement, MAX).map(d => d.key)).toEqual(['orm:users#7', 'orm:orders']);
    });

    test('ignores write statements', () => {
        expect(readDependencies(select({ statement: 'update', values: { name: 'x' } }), MAX)).toEqual([]);
    });
});

describe('writeEvents', () => {
    test('an update by id emits the row key carrying the written columns', () => {
        const statement = select({ statement: 'update', where: 'u."id" = 42', values: { name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#42', columns: ['name'] }]);
    });

    test('an update by predicate emits the table key', () => {
        const statement = select({ statement: 'update', where: "u.\"created_at\" < '2020-01-01'", values: { archived: true } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users', columns: ['archived'] }]);
    });

    test('a delete emits a wildcard because the whole row is gone', () => {
        const statement = select({ statement: 'delete', where: 'u."id" = 9' });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#9', columns: null }]);
    });

    test('an insert emits the row key so table subscribers wake through the ancestor', () => {
        const statement = select({ statement: 'insert', values: { id: 5, name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#5', columns: ['id', 'name'] }]);
    });

    test('an insert without a primary key falls back to the table', () => {
        const statement = select({ statement: 'insert', values: { name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users', columns: ['name'] }]);
    });

    test('a bulk insert emits one key per row', () => {
        const statement = select({ statement: 'insert', bulk: true, values: [{ id: 1 }, { id: 2 }] });
        expect(writeEvents(statement, MAX).map(e => e.key)).toEqual(['orm:users#1', 'orm:users#2']);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/statement-keys.test.ts`
Expected: FAIL — `Cannot find module '../src/graph/dep-key'`

- [ ] **Step 3: Implementar `dep-key.ts` e `types.ts`**

`packages/live/src/graph/dep-key.ts`:

```ts
export type DepKey = string;

const ROW_SEPARATOR = '#';

/** Key naming a whole table: every row and every column of it. */
export function tableKey(table: string): DepKey {
    return `orm:${table}`;
}

/** Key naming one row by primary key. */
export function rowKey(table: string, id: string | number): DepKey {
    return `orm:${table}${ROW_SEPARATOR}${id}`;
}

/**
 * The key itself plus every key that contains it.
 *
 * The hierarchy is exactly two levels deep and the only separator is `#`:
 * `orm:users#42` is contained by `orm:users`. Colons are NOT hierarchical —
 * splitting on them would make `orm` an ancestor of every table and
 * `app:report` an ancestor of unrelated app keys.
 */
export function ancestorsOf(key: DepKey): DepKey[] {
    const index = key.indexOf(ROW_SEPARATOR);

    if (index === -1) {
        return [key];
    }

    return [key, key.slice(0, index)];
}
```

`packages/live/src/graph/types.ts`:

```ts
import type { DepKey } from './dep-key';

/**
 * A read registered by one resource compute.
 *
 * `columns: null` is a wildcard — the read touches columns we could not
 * enumerate, so any write to the key concerns it.
 */
export interface Dependency {
    key: DepKey;
    columns: string[] | null;
}

/**
 * A write announced by an emitter.
 *
 * `columns: null` is a wildcard — the write changes the whole row (a DELETE),
 * so it concerns every reader of the key.
 */
export interface InvalidationEvent {
    key: DepKey;
    columns: string[] | null;
}
```

- [ ] **Step 4: Implementar `config.ts`**

`packages/live/src/config.ts`:

```ts
/**
 * Tunables from §10.1 of the design. These are starting points to calibrate
 * against the recompute-without-patch metric, not measured values.
 */
export interface LiveConfig {
    /** Window in ms over which invalidations for one instance are grouped. */
    coalesceMs: number;
    /** Above this many row keys, one read collapses to its table key. */
    maxKeysPerRead: number;
    /** Ceiling on the canonicalized inputs of a single subscription. */
    maxInputBytes: number;
    /** Grace period before dropping an instance whose refcount hit zero. */
    unsubGraceMs: number;
    /** Consecutive back-pressured sends before collapsing to a snapshot. */
    maxPendingPatches: number;
    /** Above this fan-out, recompute is queued instead of run inline. */
    fanoutQueueThreshold: number;
    /** Ceiling on live instances held by a single connection. */
    maxInstancesPerConnection: number;
    /** Ceiling on live instances held by this process. */
    maxInstancesPerNode: number;
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
    coalesceMs: 16,
    maxKeysPerRead: 64,
    maxInputBytes: 8192,
    unsubGraceMs: 5000,
    maxPendingPatches: 32,
    fanoutQueueThreshold: 500,
    maxInstancesPerConnection: 64,
    maxInstancesPerNode: 50000
};

export function resolveLiveConfig(overrides: Partial<LiveConfig> = {}): LiveConfig {
    return { ...DEFAULT_LIVE_CONFIG, ...overrides };
}
```

- [ ] **Step 5: Implementar `statement-keys.ts`**

`packages/live/src/emitters/statement-keys.ts`:

```ts
import type { Statement } from '@carno.js/orm';
import { rowKey, tableKey } from '../graph/dep-key';
import type { Dependency, InvalidationEvent } from '../graph/types';

const WRITE_STATEMENTS = new Set(['insert', 'update', 'delete']);
const READ_STATEMENTS = new Set(['select', 'count']);

/**
 * Turn the column list the ORM generated into bare column names.
 *
 * `SqlColumnManager.getPropertyColumns` emits `alias."column" as "alias_column"`
 * (packages/orm/src/query/sql-column-manager.ts:68-76). We want `column`.
 * Returns null (wildcard) when the list is absent or contains a star.
 */
export function normalizeColumns(columns: string[] | undefined): string[] | null {
    if (!columns || columns.length === 0) {
        return null;
    }

    const names = new Set<string>();

    for (const raw of columns) {
        const beforeAlias = raw.split(/\s+as\s+/i)[0].trim();
        const lastDot = beforeAlias.lastIndexOf('.');
        const bare = (lastDot === -1 ? beforeAlias : beforeAlias.slice(lastDot + 1)).replace(/["`\[\]]/g, '').trim();

        if (bare === '' || bare === '*' || bare.includes('(')) {
            // Star or an expression we cannot attribute to a column: wildcard.
            return null;
        }

        names.add(bare);
    }

    return [...names].sort();
}

function unquote(value: string): string {
    return value.replace(/["`\[\]]/g, '');
}

function parseLiteral(raw: string): string | number {
    const trimmed = raw.trim();

    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1);
    }

    return Number(trimmed);
}

/**
 * Extract primary-key values when — and only when — the WHERE clause is
 * exactly a primary-key equality or a primary-key IN list.
 *
 * Anything else returns null and the caller degrades to the table key.
 * Comparing arbitrary predicates is undecidable in the general case, and §4.3
 * of the design is explicit: correctness beats precision.
 */
export function extractRowIds(
    where: string | undefined,
    primaryKeyColumn: string | undefined
): (string | number)[] | null {
    if (!where || !primaryKeyColumn) {
        return null;
    }

    const trimmed = where.trim();
    const column = `(?:[\\w"\`\\[\\]]+\\.)?["\`\\[]?${primaryKeyColumn}["\`\\]]?`;

    const equality = new RegExp(`^${column}\\s*=\\s*(\\d+|'[^']*')$`, 'i').exec(trimmed);
    if (equality) {
        return [parseLiteral(equality[1])];
    }

    const inList = new RegExp(`^${column}\\s+IN\\s*\\(([^()]*)\\)$`, 'i').exec(trimmed);
    if (inList) {
        const items = inList[1].split(',').map(item => item.trim()).filter(item => item !== '');

        if (items.length === 0 || items.some(item => !/^(\d+|'[^']*')$/.test(item))) {
            return null;
        }

        return items.map(parseLiteral);
    }

    return null;
}

/** Dependencies registered by one read. Empty for writes. */
export function readDependencies(statement: Statement<any>, maxKeysPerRead: number): Dependency[] {
    if (!READ_STATEMENTS.has(statement.statement ?? '') || !statement.table) {
        return [];
    }

    const columns = normalizeColumns(statement.columns);
    const ids = extractRowIds(statement.where, statement.primaryKeyColumnName);
    const deps: Dependency[] = [];

    if (ids && ids.length <= maxKeysPerRead) {
        for (const id of ids) {
            deps.push({ key: rowKey(statement.table, id), columns });
        }
    } else {
        deps.push({ key: tableKey(statement.table), columns });
    }

    // A joined read depends on every joined table too. We cannot attribute the
    // selected columns per table, so joins are wildcard.
    for (const join of statement.join ?? []) {
        if (join.joinTable) {
            deps.push({ key: tableKey(join.joinTable), columns: null });
        }
    }

    return deps;
}

function writtenColumns(statement: Statement<any>): string[] | null {
    if (statement.statement === 'delete') {
        // The whole row is gone; every reader of it is concerned.
        return null;
    }

    const values = statement.values;

    if (!values) {
        return null;
    }

    const rows: Record<string, unknown>[] = Array.isArray(values) ? values : [values];
    const names = new Set<string>();

    for (const row of rows) {
        for (const name of Object.keys(row)) {
            names.add(unquote(name));
        }
    }

    return names.size === 0 ? null : [...names].sort();
}

function insertedIds(statement: Statement<any>): (string | number)[] | null {
    const pk = statement.primaryKeyColumnName;

    if (!pk || !statement.values) {
        return null;
    }

    const rows: Record<string, unknown>[] = Array.isArray(statement.values)
        ? statement.values
        : [statement.values];
    const ids: (string | number)[] = [];

    for (const row of rows) {
        const value = row[pk];

        if (typeof value !== 'string' && typeof value !== 'number') {
            return null;
        }

        ids.push(value);
    }

    return ids.length === 0 ? null : ids;
}

/** Invalidation events announced by one write. Empty for reads. */
export function writeEvents(statement: Statement<any>, maxKeysPerRead: number): InvalidationEvent[] {
    if (!WRITE_STATEMENTS.has(statement.statement ?? '') || !statement.table) {
        return [];
    }

    const columns = writtenColumns(statement);
    const ids = statement.statement === 'insert'
        ? insertedIds(statement)
        : extractRowIds(statement.where, statement.primaryKeyColumnName);

    if (ids && ids.length <= maxKeysPerRead) {
        return ids.map(id => ({ key: rowKey(statement.table!, id), columns }));
    }

    return [{ key: tableKey(statement.table), columns }];
}
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `bun test packages/live/test/statement-keys.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): derive dependency keys from ORM statements

Row key when the WHERE clause is provably a primary-key match, table key
otherwise. Correctness beats precision: an unprovable predicate degrades to
the ancestor, never to no key at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `DependencyGraph`

Uma das duas estruturas do §4.2. Sabe ligar chave a instância, resolver
ancestrais e filtrar por coluna. Não conhece WebSocket nem ORM.

**Files:**
- Create: `packages/live/src/graph/DependencyGraph.ts`
- Test: `packages/live/test/dependency-graph.test.ts`

**Interfaces:**
- Consumes: `Dependency`, `InvalidationEvent` (Task 2), `ancestorsOf` (Task 2).
- Produces: `class DependencyGraph` com
  `setDependencies(instanceId: string, deps: Dependency[]): void`,
  `remove(instanceId: string): void`,
  `resolve(event: InvalidationEvent): string[]`,
  `keyCount(): number`,
  `instanceCount(): number`.

`setDependencies` **substitui** as dependências da instância: um recompute pode
ler tabelas diferentes do anterior, e deixar as antigas para trás vaza memória e
gera recompute fantasma.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/dependency-graph.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DependencyGraph } from '../src/graph/DependencyGraph';

describe('DependencyGraph', () => {
    test('resolves an instance that depends on the exact key', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null })).toEqual(['i1']);
    });

    test('a row write wakes the table subscriber through the ancestor', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('list', [{ key: 'orm:users', columns: null }]);
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null }).sort()).toEqual(['detail', 'list']);
    });

    test('a table write wakes row subscribers because it may touch any row', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual(['detail']);
    });

    test('does not wake a row subscriber for a different row', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#7', columns: null })).toEqual([]);
    });

    test('skips an instance whose read columns do not intersect the write', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users', columns: ['id', 'name'] }]);

        expect(graph.resolve({ key: 'orm:users', columns: ['last_seen_at'] })).toEqual([]);
        expect(graph.resolve({ key: 'orm:users', columns: ['name'] })).toEqual(['i1']);
    });

    test('a wildcard on either side always intersects', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('narrow', [{ key: 'orm:users', columns: ['id'] }]);
        graph.setDependencies('wide', [{ key: 'orm:users', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null }).sort()).toEqual(['narrow', 'wide']);
        expect(graph.resolve({ key: 'orm:users', columns: ['zzz'] })).toEqual(['wide']);
    });

    test('returns each instance once even when several keys match', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [
            { key: 'orm:users', columns: null },
            { key: 'orm:users#42', columns: null }
        ]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null })).toEqual(['i1']);
    });

    test('replacing dependencies drops the previous ones', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users', columns: null }]);
        graph.setDependencies('i1', [{ key: 'orm:orders', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual([]);
        expect(graph.resolve({ key: 'orm:orders', columns: null })).toEqual(['i1']);
        expect(graph.keyCount()).toBe(1);
    });

    test('remove clears every key the instance held', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [
            { key: 'orm:users', columns: null },
            { key: 'orm:orders', columns: null }
        ]);
        graph.remove('i1');

        expect(graph.keyCount()).toBe(0);
        expect(graph.instanceCount()).toBe(0);
        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual([]);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/dependency-graph.test.ts`
Expected: FAIL — `Cannot find module '../src/graph/DependencyGraph'`

- [ ] **Step 3: Implementar `DependencyGraph`**

`packages/live/src/graph/DependencyGraph.ts`:

```ts
import { ancestorsOf, type DepKey } from './dep-key';
import type { Dependency, InvalidationEvent } from './types';

/** Column sets registered per instance under one key. null means wildcard. */
type ColumnSet = Set<string> | null;

/**
 * Key ↔ instance index with ancestor resolution and column filtering.
 *
 * Knows nothing about WebSocket, the ORM, or resources — it is a pure data
 * structure, which is why the hard part of the invalidation logic is testable
 * without a server, a database or a socket.
 */
export class DependencyGraph {
    private readonly byKey = new Map<DepKey, Map<string, ColumnSet>>();
    private readonly byInstance = new Map<string, Set<DepKey>>();

    /**
     * Replace every dependency held by this instance.
     *
     * A recompute can read different tables than the previous one; keeping the
     * stale keys would both leak memory and cause phantom recomputes.
     */
    setDependencies(instanceId: string, deps: Dependency[]): void {
        this.remove(instanceId);

        if (deps.length === 0) {
            return;
        }

        const keys = new Set<DepKey>();

        for (const dep of deps) {
            keys.add(dep.key);

            let holders = this.byKey.get(dep.key);
            if (!holders) {
                holders = new Map<string, ColumnSet>();
                this.byKey.set(dep.key, holders);
            }

            const existing = holders.get(instanceId);

            if (dep.columns === null || existing === null) {
                // Wildcard wins: two reads of the same key under one instance
                // widen to the union, and null is the widest.
                holders.set(instanceId, existing === undefined && dep.columns !== null
                    ? new Set(dep.columns)
                    : null);
                if (dep.columns === null) {
                    holders.set(instanceId, null);
                }
            } else if (existing === undefined) {
                holders.set(instanceId, new Set(dep.columns));
            } else {
                for (const column of dep.columns) {
                    existing.add(column);
                }
            }
        }

        this.byInstance.set(instanceId, keys);
    }

    /** Forget the instance entirely. */
    remove(instanceId: string): void {
        const keys = this.byInstance.get(instanceId);

        if (!keys) {
            return;
        }

        for (const key of keys) {
            const holders = this.byKey.get(key);

            if (!holders) {
                continue;
            }

            holders.delete(instanceId);

            if (holders.size === 0) {
                this.byKey.delete(key);
            }
        }

        this.byInstance.delete(instanceId);
    }

    /**
     * Instances concerned by this write.
     *
     * Both directions of the hierarchy matter. A write to `orm:users#42` wakes
     * subscribers of `orm:users` (the ancestor contains the row). A write to
     * `orm:users` wakes subscribers of `orm:users#42`, because a predicate
     * write may well have touched row 42 and we cannot prove it did not.
     */
    resolve(event: InvalidationEvent): string[] {
        const matched = new Set<string>();

        for (const key of ancestorsOf(event.key)) {
            this.collect(key, event.columns, matched);
        }

        const descendantPrefix = `${event.key}#`;
        if (!event.key.includes('#')) {
            for (const key of this.byKey.keys()) {
                if (key.startsWith(descendantPrefix)) {
                    this.collect(key, event.columns, matched);
                }
            }
        }

        return [...matched];
    }

    keyCount(): number {
        return this.byKey.size;
    }

    instanceCount(): number {
        return this.byInstance.size;
    }

    private collect(key: DepKey, writtenColumns: string[] | null, into: Set<string>): void {
        const holders = this.byKey.get(key);

        if (!holders) {
            return;
        }

        for (const [instanceId, readColumns] of holders) {
            if (intersects(readColumns, writtenColumns)) {
                into.add(instanceId);
            }
        }
    }
}

function intersects(readColumns: Set<string> | null, writtenColumns: string[] | null): boolean {
    if (readColumns === null || writtenColumns === null) {
        return true;
    }

    for (const column of writtenColumns) {
        if (readColumns.has(column)) {
            return true;
        }
    }

    return false;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bun test packages/live/test/dependency-graph.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Simplificar o ramo confuso de união de colunas**

O bloco `if (dep.columns === null || existing === null)` do Step 3 está
redundante. Substituir o corpo do `for (const dep of deps)` por:

```ts
        for (const dep of deps) {
            keys.add(dep.key);

            let holders = this.byKey.get(dep.key);
            if (!holders) {
                holders = new Map<string, ColumnSet>();
                this.byKey.set(dep.key, holders);
            }

            if (!holders.has(instanceId)) {
                holders.set(instanceId, dep.columns === null ? null : new Set(dep.columns));
                continue;
            }

            const existing = holders.get(instanceId)!;

            if (existing === null) {
                continue;   // already the widest possible set
            }

            if (dep.columns === null) {
                holders.set(instanceId, null);
                continue;
            }

            for (const column of dep.columns) {
                existing.add(column);
            }
        }
```

- [ ] **Step 6: Rodar o teste de novo**

Run: `bun test packages/live/test/dependency-graph.test.ts`
Expected: PASS — 9 tests (mesmo resultado, código mais claro).

- [ ] **Step 7: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add DependencyGraph with ancestor resolution and column filter

Resolution walks the hierarchy both ways: a row write wakes table
subscribers, and a predicate write wakes row subscribers because we cannot
prove it missed them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `SubscriptionRegistry`

A segunda estrutura do §4.2, e o refcount da §6.4. Duas abas com os mesmos
inputs compartilham uma instância; duas telas na mesma aba compartilham a mesma
conexão.

**Files:**
- Create: `packages/live/src/graph/SubscriptionRegistry.ts`
- Test: `packages/live/test/subscription-registry.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `class SubscriptionRegistry` com
  `subscribe(connectionId: string, instanceId: string): number`,
  `unsubscribe(connectionId: string, instanceId: string): number`,
  `dropConnection(connectionId: string): string[]`,
  `connectionsOf(instanceId: string): string[]`,
  `hasSubscribers(instanceId: string): boolean`,
  `countForConnection(connectionId: string): number`,
  `instanceCount(): number`.

`subscribe`/`unsubscribe` devolvem o refcount **da conexão sobre a instância**.
`dropConnection` devolve as instâncias que ficaram sem nenhum assinante.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/subscription-registry.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';

describe('SubscriptionRegistry', () => {
    test('tracks one connection subscribing once', () => {
        const registry = new SubscriptionRegistry();

        expect(registry.subscribe('c1', 'i1')).toBe(1);
        expect(registry.connectionsOf('i1')).toEqual(['c1']);
        expect(registry.instanceCount()).toBe(1);
    });

    test('refcounts repeated subscriptions from the same connection', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');

        expect(registry.subscribe('c1', 'i1')).toBe(2);
        expect(registry.connectionsOf('i1')).toEqual(['c1']);
        expect(registry.unsubscribe('c1', 'i1')).toBe(1);
        expect(registry.hasSubscribers('i1')).toBe(true);
        expect(registry.unsubscribe('c1', 'i1')).toBe(0);
        expect(registry.hasSubscribers('i1')).toBe(false);
    });

    test('two connections share one instance', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c2', 'i1');

        expect(registry.connectionsOf('i1').sort()).toEqual(['c1', 'c2']);
        registry.unsubscribe('c1', 'i1');
        expect(registry.hasSubscribers('i1')).toBe(true);
    });

    test('counts distinct instances per connection for the per-connection ceiling', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i2');

        expect(registry.countForConnection('c1')).toBe(2);
    });

    test('dropping a connection returns the instances left with no subscriber', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i2');
        registry.subscribe('c2', 'i2');

        expect(registry.dropConnection('c1').sort()).toEqual(['i1']);
        expect(registry.hasSubscribers('i2')).toBe(true);
        expect(registry.countForConnection('c1')).toBe(0);
    });

    test('unsubscribing something never subscribed is a no-op', () => {
        const registry = new SubscriptionRegistry();

        expect(registry.unsubscribe('c1', 'i1')).toBe(0);
        expect(registry.dropConnection('nope')).toEqual([]);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/subscription-registry.test.ts`
Expected: FAIL — `Cannot find module '../src/graph/SubscriptionRegistry'`

- [ ] **Step 3: Implementar `SubscriptionRegistry`**

`packages/live/src/graph/SubscriptionRegistry.ts`:

```ts
/**
 * Instance ↔ connection index with per-pair refcounting.
 *
 * The refcount is per (connection, instance) pair because one page can mount
 * two components bound to the same resource with the same inputs: unmounting
 * one must not unsubscribe the other.
 */
export class SubscriptionRegistry {
    private readonly byInstance = new Map<string, Map<string, number>>();
    private readonly byConnection = new Map<string, Set<string>>();

    /** Returns the connection's refcount on this instance after the call. */
    subscribe(connectionId: string, instanceId: string): number {
        let holders = this.byInstance.get(instanceId);
        if (!holders) {
            holders = new Map<string, number>();
            this.byInstance.set(instanceId, holders);
        }

        const next = (holders.get(connectionId) ?? 0) + 1;
        holders.set(connectionId, next);

        let owned = this.byConnection.get(connectionId);
        if (!owned) {
            owned = new Set<string>();
            this.byConnection.set(connectionId, owned);
        }
        owned.add(instanceId);

        return next;
    }

    /** Returns the connection's refcount on this instance after the call. */
    unsubscribe(connectionId: string, instanceId: string): number {
        const holders = this.byInstance.get(instanceId);
        const current = holders?.get(connectionId) ?? 0;

        if (!holders || current === 0) {
            return 0;
        }

        const next = current - 1;

        if (next === 0) {
            holders.delete(connectionId);
            this.byConnection.get(connectionId)?.delete(instanceId);

            if (holders.size === 0) {
                this.byInstance.delete(instanceId);
            }
        } else {
            holders.set(connectionId, next);
        }

        return next;
    }

    /** Drop the connection; returns instances now left with no subscriber. */
    dropConnection(connectionId: string): string[] {
        const owned = this.byConnection.get(connectionId);

        if (!owned) {
            return [];
        }

        const orphaned: string[] = [];

        for (const instanceId of owned) {
            const holders = this.byInstance.get(instanceId);

            if (!holders) {
                continue;
            }

            holders.delete(connectionId);

            if (holders.size === 0) {
                this.byInstance.delete(instanceId);
                orphaned.push(instanceId);
            }
        }

        this.byConnection.delete(connectionId);

        return orphaned;
    }

    connectionsOf(instanceId: string): string[] {
        return [...(this.byInstance.get(instanceId)?.keys() ?? [])];
    }

    hasSubscribers(instanceId: string): boolean {
        return this.byInstance.has(instanceId);
    }

    /** Distinct instances held by the connection — the per-connection ceiling. */
    countForConnection(connectionId: string): number {
        return this.byConnection.get(connectionId)?.size ?? 0;
    }

    instanceCount(): number {
        return this.byInstance.size;
    }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bun test packages/live/test/subscription-registry.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add SubscriptionRegistry with per-pair refcounting

One page can mount two components bound to the same resource with the same
inputs; unmounting one must not unsubscribe the other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `PatchEngine`

O §4.6. Duas propriedades não negociáveis, e as duas são testes: `apply(prev,
diff(prev, next))` é igual a `next`, e sub-objetos intocados **mantêm
identidade de referência**. A segunda não é otimização — sem ela
`useSyncExternalStore` entra em loop de render.

**Files:**
- Create: `packages/live/src/patch/types.ts`
- Create: `packages/live/src/patch/PatchEngine.ts`
- Test: `packages/live/test/patch-engine.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type PathSegment = string | number`
  - `type PatchOp` — união de `set`, `unset`, `upsert`, `remove`, `order`
  - `class PatchEngine { constructor(keyField?: string); diff(prev, next): PatchOp[]; apply(prev, ops): unknown }`

`keyField` é o `key` do `@Live({ key: 'id' })`. Sem ele, arrays são substituídos
inteiros. Com ele, um array cujos elementos todos tenham o campo vira diff por
chave.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/patch-engine.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { PatchEngine } from '../src/patch/PatchEngine';

describe('PatchEngine without a key', () => {
    const engine = new PatchEngine();

    test('produces no ops for deep-equal values', () => {
        expect(engine.diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
    });

    test('sets a changed leaf', () => {
        expect(engine.diff({ a: 1 }, { a: 2 })).toEqual([{ op: 'set', path: ['a'], value: 2 }]);
    });

    test('unsets a removed property', () => {
        expect(engine.diff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: 'unset', path: ['b'] }]);
    });

    test('recurses into nested objects instead of replacing them', () => {
        expect(engine.diff({ a: { b: 1, c: 2 } }, { a: { b: 9, c: 2 } }))
            .toEqual([{ op: 'set', path: ['a', 'b'], value: 9 }]);
    });

    test('replaces an unkeyed array wholesale', () => {
        expect(engine.diff({ xs: [1, 2] }, { xs: [1, 2, 3] }))
            .toEqual([{ op: 'set', path: ['xs'], value: [1, 2, 3] }]);
    });
});

describe('PatchEngine with a key', () => {
    const engine = new PatchEngine('id');

    const a = { id: 1, name: 'Ada' };
    const b = { id: 2, name: 'Bob' };
    const c = { id: 3, name: 'Cid' };

    test('inserting at the top is an upsert plus an order, not a rebuild', () => {
        const ops = engine.diff([a, b], [c, a, b]);

        expect(ops).toEqual([
            { op: 'upsert', path: [], key: 3, index: 0, value: c },
            { op: 'order', path: [], keys: [3, 1, 2] }
        ]);
    });

    test('changing one row touches only that row', () => {
        const ops = engine.diff([a, b], [a, { id: 2, name: 'Bobby' }]);

        expect(ops).toEqual([
            { op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, name: 'Bobby' } }
        ]);
    });

    test('removing a row emits remove', () => {
        expect(engine.diff([a, b], [a])).toEqual([{ op: 'remove', path: [], key: 2 }]);
    });

    test('reordering without changing content emits only order', () => {
        expect(engine.diff([a, b], [b, a])).toEqual([{ op: 'order', path: [], keys: [2, 1] }]);
    });

    test('applies keyed diffs to arrays nested in objects', () => {
        const ops = engine.diff({ users: [a, b] }, { users: [a] });
        expect(ops).toEqual([{ op: 'remove', path: ['users'], key: 2 }]);
    });

    test('falls back to a whole-array set when an element lacks the key', () => {
        const ops = engine.diff([a], [a, { name: 'no id' }]);
        expect(ops).toEqual([{ op: 'set', path: [], value: [a, { name: 'no id' }] }]);
    });
});

describe('PatchEngine.apply', () => {
    test('round-trips: apply(prev, diff(prev, next)) deep-equals next', () => {
        const engine = new PatchEngine('id');
        const cases: [unknown, unknown][] = [
            [{ a: 1 }, { a: 2 }],
            [{ a: 1, b: 2 }, { a: 1 }],
            [{ a: { b: 1 } }, { a: { b: 2, c: 3 } }],
            [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]],
            [[{ id: 1, n: 'a' }], [{ id: 1, n: 'b' }, { id: 2, n: 'c' }]],
            [{ users: [{ id: 1 }] }, { users: [] }],
            [{ xs: [1, 2] }, { xs: [3] }]
        ];

        for (const [prev, next] of cases) {
            expect(engine.apply(prev, engine.diff(prev, next))).toEqual(next as any);
        }
    });

    test('untouched sibling objects keep reference identity', () => {
        const engine = new PatchEngine();
        const prev = { left: { deep: { n: 1 } }, right: { n: 2 } };
        const next = { left: { deep: { n: 1 } }, right: { n: 3 } };

        const applied = engine.apply(prev, engine.diff(prev, next)) as typeof prev;

        expect(applied.left).toBe(prev.left);
        expect(applied).not.toBe(prev);
        expect(applied.right).not.toBe(prev.right);
    });

    test('untouched rows of a keyed list keep reference identity', () => {
        const engine = new PatchEngine('id');
        const kept = { id: 1, name: 'Ada' };
        const prev = [kept, { id: 2, name: 'Bob' }];
        const next = [kept, { id: 2, name: 'Bobby' }];

        const applied = engine.apply(prev, engine.diff(prev, next)) as typeof prev;

        expect(applied[0]).toBe(kept);
        expect(applied).not.toBe(prev);
    });

    test('an empty op list returns the very same root', () => {
        const engine = new PatchEngine();
        const prev = { a: 1 };

        expect(engine.apply(prev, [])).toBe(prev);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/patch-engine.test.ts`
Expected: FAIL — `Cannot find module '../src/patch/PatchEngine'`

- [ ] **Step 3: Implementar os tipos de op**

`packages/live/src/patch/types.ts`:

```ts
export type PathSegment = string | number;

/** Replace the value at `path`. */
export interface SetOp {
    op: 'set';
    path: PathSegment[];
    value: unknown;
}

/** Delete the property at `path`. */
export interface UnsetOp {
    op: 'unset';
    path: PathSegment[];
}

/** Insert or replace, by key, one row of the keyed array at `path`. */
export interface UpsertOp {
    op: 'upsert';
    path: PathSegment[];
    key: string | number;
    /** Target index in the resulting array; used when the row is new. */
    index: number;
    value: unknown;
}

/** Remove, by key, one row of the keyed array at `path`. */
export interface RemoveOp {
    op: 'remove';
    path: PathSegment[];
    key: string | number;
}

/** Final key order of the keyed array at `path`. */
export interface OrderOp {
    op: 'order';
    path: PathSegment[];
    keys: (string | number)[];
}

export type PatchOp = SetOp | UnsetOp | UpsertOp | RemoveOp | OrderOp;
```

- [ ] **Step 4: Implementar `PatchEngine`**

`packages/live/src/patch/PatchEngine.ts`:

```ts
import type { PatchOp, PathSegment } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, i) => deepEqual(item, right[i]));
    }

    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left);

        if (leftKeys.length !== Object.keys(right).length) {
            return false;
        }

        return leftKeys.every(key =>
            Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key])
        );
    }

    return false;
}

/**
 * Snapshot → snapshot diffing, and patch application with structural sharing.
 *
 * Structural sharing is a requirement, not an optimization: React's
 * `useSyncExternalStore` demands a referentially stable `getSnapshot()` between
 * renders, and rebuilding the whole tree on every patch puts it in a render
 * loop. As a side effect `React.memo`, Angular's `OnPush` and signal equality
 * all start filtering correctly, so only the changed row re-renders.
 */
export class PatchEngine {
    constructor(private readonly keyField?: string) {}

    diff(prev: unknown, next: unknown): PatchOp[] {
        const ops: PatchOp[] = [];
        this.diffValue(prev, next, [], ops);
        return ops;
    }

    apply(prev: unknown, ops: PatchOp[]): unknown {
        if (ops.length === 0) {
            return prev;
        }

        let root = prev;

        for (const op of ops) {
            root = this.applyOne(root, op);
        }

        return root;
    }

    // ---------------------------------------------------------------- diff

    private diffValue(prev: unknown, next: unknown, path: PathSegment[], ops: PatchOp[]): void {
        if (prev === next) {
            return;
        }

        if (Array.isArray(prev) && Array.isArray(next)) {
            if (this.isKeyed(prev) && this.isKeyed(next)) {
                this.diffKeyedArray(prev, next, path, ops);
                return;
            }

            if (!deepEqual(prev, next)) {
                ops.push({ op: 'set', path, value: next });
            }
            return;
        }

        if (isPlainObject(prev) && isPlainObject(next)) {
            for (const key of Object.keys(prev)) {
                if (!Object.prototype.hasOwnProperty.call(next, key)) {
                    ops.push({ op: 'unset', path: [...path, key] });
                }
            }

            for (const key of Object.keys(next)) {
                if (!Object.prototype.hasOwnProperty.call(prev, key)) {
                    ops.push({ op: 'set', path: [...path, key], value: next[key] });
                    continue;
                }

                this.diffValue(prev[key], next[key], [...path, key], ops);
            }
            return;
        }

        if (!deepEqual(prev, next)) {
            ops.push({ op: 'set', path, value: next });
        }
    }

    private diffKeyedArray(
        prev: unknown[],
        next: unknown[],
        path: PathSegment[],
        ops: PatchOp[]
    ): void {
        const prevByKey = this.indexByKey(prev);
        const nextByKey = this.indexByKey(next);

        for (const key of prevByKey.keys()) {
            if (!nextByKey.has(key)) {
                ops.push({ op: 'remove', path, key });
            }
        }

        next.forEach((row, index) => {
            const key = this.keyOf(row)!;
            const before = prevByKey.get(key);

            if (before === undefined || !deepEqual(before, row)) {
                ops.push({ op: 'upsert', path, key, index, value: row });
            }
        });

        const survivingPrevKeys = [...prevByKey.keys()].filter(key => nextByKey.has(key));
        const nextKeys = [...nextByKey.keys()];
        const orderChanged =
            survivingPrevKeys.length !== nextKeys.length ||
            survivingPrevKeys.some((key, i) => key !== nextKeys[i]);

        if (orderChanged) {
            ops.push({ op: 'order', path, keys: nextKeys });
        }
    }

    private isKeyed(value: unknown[]): boolean {
        if (!this.keyField) {
            return false;
        }

        return value.every(item => this.keyOf(item) !== undefined);
    }

    private keyOf(row: unknown): string | number | undefined {
        if (!this.keyField || !isPlainObject(row)) {
            return undefined;
        }

        const value = row[this.keyField];

        return typeof value === 'string' || typeof value === 'number' ? value : undefined;
    }

    private indexByKey(rows: unknown[]): Map<string | number, unknown> {
        const index = new Map<string | number, unknown>();

        for (const row of rows) {
            index.set(this.keyOf(row)!, row);
        }

        return index;
    }

    // --------------------------------------------------------------- apply

    private applyOne(root: unknown, op: PatchOp): unknown {
        if (op.op === 'set') {
            return this.replaceAt(root, op.path, () => op.value);
        }

        if (op.op === 'unset') {
            const parentPath = op.path.slice(0, -1);
            const key = op.path[op.path.length - 1];

            return this.replaceAt(root, parentPath, current => {
                if (!isPlainObject(current)) {
                    return current;
                }

                const clone = { ...current };
                delete clone[String(key)];
                return clone;
            });
        }

        return this.replaceAt(root, op.path, current => {
            const rows = Array.isArray(current) ? current : [];

            if (op.op === 'remove') {
                return rows.filter(row => this.keyOf(row) !== op.key);
            }

            if (op.op === 'upsert') {
                const index = rows.findIndex(row => this.keyOf(row) === op.key);

                if (index === -1) {
                    const clone = rows.slice();
                    clone.splice(Math.min(op.index, clone.length), 0, op.value);
                    return clone;
                }

                const clone = rows.slice();
                clone[index] = op.value;
                return clone;
            }

            // order
            const byKey = new Map(rows.map(row => [this.keyOf(row), row] as const));
            return op.keys.map(key => byKey.get(key)).filter(row => row !== undefined);
        });
    }

    /**
     * Rebuild only the containers along `path`. Everything off the path keeps
     * its original reference — that is the structural sharing.
     */
    private replaceAt(
        root: unknown,
        path: PathSegment[],
        update: (current: unknown) => unknown
    ): unknown {
        if (path.length === 0) {
            return update(root);
        }

        const [head, ...rest] = path;

        if (Array.isArray(root)) {
            const index = Number(head);
            const clone = root.slice();
            clone[index] = this.replaceAt(root[index], rest, update);
            return clone;
        }

        const base = isPlainObject(root) ? root : {};
        const key = String(head);

        return { ...base, [key]: this.replaceAt(base[key], rest, update) };
    }
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `bun test packages/live/test/patch-engine.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add PatchEngine with keyed diffs and structural sharing

Structural sharing is a requirement, not an optimization: useSyncExternalStore
demands a referentially stable getSnapshot() and loops without it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `@Live()`, escopo e identidade de instância

O decorator e a regra de identidade. É aqui que mora a isolação entre tenants
(critério de aceite 8), e é por isso que o escopo entra **literal** na chave, sem
passar por hash — ver "Desvios deliberados", item 1.

**Files:**
- Create: `packages/live/src/metadata.ts`
- Create: `packages/live/src/decorators/Live.ts`
- Create: `packages/live/src/shared/inputs.ts`
- Create: `packages/live/src/resource/types.ts`
- Create: `packages/live/src/resource/instance-id.ts`
- Test: `packages/live/test/instance-id.test.ts`

**Interfaces:**
- Consumes: `canonical`, `fnv1a64` (Task 1); `LiveConfig` (Task 2).
- Produces:
  - `const LIVE_META: symbol`
  - `interface LiveOptions { key?: string; shared?: 'private' | 'tenant' | 'public'; dependsOn?: string[] }`
  - `interface LiveMeta { key?: string; shared: 'private' | 'tenant' | 'public'; dependsOn: string[]; handlerName: string }`
  - `function Live(options?: LiveOptions): MethodDecorator`
  - `interface LiveInputs { params: Record<string, string>; query: Record<string, string | string[]> }`
  - `interface LiveScope { principal?: string | number; tenant?: string | number }`
  - `class MissingScopeError extends Error`, `class InputTooLargeError extends Error`
  - `scopeKeyOf(shared, scope): string`
  - `canonicalInputs(inputs, maxInputBytes): string`
  - `instanceIdOf(resourceId, scopeKey, canonicalInputs): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/instance-id.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Controller, Get } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { LIVE_META, type LiveMeta } from '../src/metadata';
import {
    canonicalInputs,
    InputTooLargeError,
    instanceIdOf,
    MissingScopeError,
    scopeKeyOf
} from '../src/resource/instance-id';

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id' })
    list() {
        return [];
    }

    @Get('/:id')
    @Live({ shared: 'tenant' })
    get() {
        return {};
    }

    @Get('/stats')
    plain() {
        return {};
    }
}

function metaOf(handler: string): LiveMeta | undefined {
    return Reflect.getMetadata(LIVE_META, UsersController, handler);
}

describe('@Live', () => {
    test('defaults to private scope and records the handler name', () => {
        expect(metaOf('list')).toEqual({ key: 'id', shared: 'private', dependsOn: [], handlerName: 'list' });
    });

    test('carries an explicit shared scope', () => {
        expect(metaOf('get')?.shared).toBe('tenant');
    });

    test('leaves undecorated handlers alone', () => {
        expect(metaOf('plain')).toBeUndefined();
    });
});

describe('scopeKeyOf', () => {
    test('public collapses to a single shared bucket', () => {
        expect(scopeKeyOf('public', {})).toBe('pub');
    });

    test('tenant and principal are embedded literally, never hashed', () => {
        expect(scopeKeyOf('tenant', { tenant: 'acme' })).toBe('t:acme');
        expect(scopeKeyOf('private', { principal: 42 })).toBe('p:42');
    });

    test('encodes separators so two tenants cannot forge each other keys', () => {
        expect(scopeKeyOf('tenant', { tenant: 'a|b' })).toBe('t:a%7Cb');
    });

    test('refuses a scope it cannot resolve rather than falling back', () => {
        expect(() => scopeKeyOf('tenant', {})).toThrow(MissingScopeError);
        expect(() => scopeKeyOf('private', {})).toThrow(MissingScopeError);
    });
});

describe('instanceIdOf', () => {
    const inputs = { params: {}, query: { status: 'active' } };

    test('is stable for the same resource, scope and inputs', () => {
        const a = instanceIdOf('UsersController.list', 'pub', canonicalInputs(inputs, 8192));
        const b = instanceIdOf('UsersController.list', 'pub', canonicalInputs({ query: { status: 'active' }, params: {} }, 8192));

        expect(a).toBe(b);
    });

    test('two tenants never share an instance', () => {
        const canonical = canonicalInputs(inputs, 8192);
        const a = instanceIdOf('UsersController.list', scopeKeyOf('tenant', { tenant: 'acme' }), canonical);
        const b = instanceIdOf('UsersController.list', scopeKeyOf('tenant', { tenant: 'globex' }), canonical);

        expect(a).not.toBe(b);
        expect(a.startsWith('UsersController.list|t:acme|')).toBe(true);
    });

    test('different inputs produce different instances', () => {
        const a = instanceIdOf('r', 'pub', canonicalInputs({ params: {}, query: { s: 'a' } }, 8192));
        const b = instanceIdOf('r', 'pub', canonicalInputs({ params: {}, query: { s: 'b' } }, 8192));

        expect(a).not.toBe(b);
    });
});

describe('canonicalInputs', () => {
    test('rejects inputs above the ceiling', () => {
        const inputs = { params: {}, query: { q: 'x'.repeat(9000) } };

        expect(() => canonicalInputs(inputs, 8192)).toThrow(InputTooLargeError);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/instance-id.test.ts`
Expected: FAIL — `Cannot find module '../src/decorators/Live'`

- [ ] **Step 3: Implementar `metadata.ts` e o decorator**

`packages/live/src/metadata.ts`:

```ts
export const LIVE_META = Symbol('carno:live');

export type LiveShared = 'private' | 'tenant' | 'public';

export interface LiveOptions {
    /**
     * Field that identifies a row of the returned collection. Without it an
     * array diff is positional: inserting at the top rebuilds the whole list,
     * the user loses input focus and animations restart.
     */
    key?: string;

    /**
     * Who may share one computed instance. Private is the safe default: with
     * no declaration the worst case is spending CPU twice, never showing one
     * user another user's data.
     */
    shared?: LiveShared;

    /**
     * Manual dependency keys, for reads the ORM cannot see (raw SQL, an
     * external API, Redis, a file).
     */
    dependsOn?: string[];
}

export interface LiveMeta {
    key?: string;
    shared: LiveShared;
    dependsOn: string[];
    handlerName: string;
}
```

`packages/live/src/decorators/Live.ts`:

```ts
import 'reflect-metadata';
import { LIVE_META, type LiveMeta, type LiveOptions } from '../metadata';

/**
 * Marks an existing route as subscribable.
 *
 * The handler stays a plain HTTP route: `GET /users?status=active` keeps
 * answering JSON for curl, SSR, mobile and Postman, through the existing
 * middleware, CORS, validation and cache. There is no parallel live universe
 * next to HTTP.
 */
export function Live(options: LiveOptions = {}): MethodDecorator {
    return function (target: any, propertyKey: string | symbol): void {
        const meta: LiveMeta = {
            key: options.key,
            shared: options.shared ?? 'private',
            dependsOn: options.dependsOn ?? [],
            handlerName: String(propertyKey)
        };

        Reflect.defineMetadata(LIVE_META, meta, target.constructor, String(propertyKey));
    };
}
```

- [ ] **Step 4: Implementar `shared/inputs.ts` e `resource/types.ts`**

`LiveInputs` and `LiveScope` live under `shared/` because the client bundle
needs them and must not pull in `resource/types.ts`, which imports from
`@carno.js/core`.

`packages/live/src/shared/inputs.ts`:

```ts
/**
 * Everything a resource compute is allowed to read from the caller.
 *
 * There is deliberately no request, no headers and no locals: a recompute has
 * none of them, and depending on them would break the "state is recomputable
 * from inputs" property the whole design rests on.
 */
export interface LiveInputs {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
}

/**
 * Ambient dimensions the result depends on. Resolved on the server from the
 * connection — never sent by the client.
 */
export interface LiveScope {
    principal?: string | number;
    tenant?: string | number;
}
```

`packages/live/src/resource/types.ts`:

```ts
import type { ParamMetadata } from '@carno.js/core';
import type { LiveMeta } from '../metadata';

export type { LiveInputs, LiveScope } from '../shared/inputs';

export interface LiveResource {
    /** `${controllerName}.${handlerName}` */
    id: string;
    controllerName: string;
    handlerName: string;
    meta: LiveMeta;
    params: ParamMetadata[];
    invoke(args: unknown[]): Promise<unknown>;
}
```

Se `ParamMetadata` não estiver exportado por `@carno.js/core`, exportá-lo:
em `packages/core/src/index.ts`, adicionar
`export type { ParamMetadata, ParamType } from './decorators/params';`

- [ ] **Step 5: Implementar `resource/instance-id.ts`**

`packages/live/src/resource/instance-id.ts`:

```ts
import { canonical } from '../shared/canonical';
import { fnv1a64 } from '../shared/hash';
import type { LiveShared } from '../metadata';
import type { LiveInputs, LiveScope } from '../shared/inputs';

export class MissingScopeError extends Error {
    constructor(public readonly dimension: 'tenant' | 'principal') {
        super(
            `Live resource requires a ${dimension} in scope but none was resolved. ` +
            `Register a LiveScopeResolver, or declare the resource as @Live({ shared: 'public' }).`
        );
        this.name = 'MissingScopeError';
    }
}

export class InputTooLargeError extends Error {
    constructor(public readonly size: number, public readonly limit: number) {
        super(`Live subscription inputs are ${size} bytes, over the ${limit} byte limit.`);
        this.name = 'InputTooLargeError';
    }
}

/**
 * The scope half of the instance identity, embedded literally.
 *
 * This is deliberately NOT hashed. Hashing it would make tenant isolation
 * depend on the absence of a hash collision, and a collision there does not
 * cost CPU — it shows one tenant another tenant's rows. Encoding keeps `|`
 * out of the value so no scope can forge another one's key.
 */
export function scopeKeyOf(shared: LiveShared, scope: LiveScope): string {
    if (shared === 'public') {
        return 'pub';
    }

    if (shared === 'tenant') {
        if (scope.tenant === undefined || scope.tenant === null || scope.tenant === '') {
            throw new MissingScopeError('tenant');
        }

        return `t:${encodeURIComponent(String(scope.tenant))}`;
    }

    if (scope.principal === undefined || scope.principal === null || scope.principal === '') {
        throw new MissingScopeError('principal');
    }

    return `p:${encodeURIComponent(String(scope.principal))}`;
}

/** Canonical form of the inputs, guarded by the size ceiling. */
export function canonicalInputs(inputs: LiveInputs, maxInputBytes: number): string {
    const encoded = canonical({ params: inputs.params ?? {}, query: inputs.query ?? {} });
    const size = Buffer.byteLength(encoded, 'utf8');

    if (size > maxInputBytes) {
        throw new InputTooLargeError(size, maxInputBytes);
    }

    return encoded;
}

/**
 * Identity of a live instance: same resource, same scope and same inputs means
 * one compute, one diff, N sends.
 */
export function instanceIdOf(resourceId: string, scopeKey: string, canonicalInputsValue: string): string {
    return `${resourceId}|${scopeKey}|${fnv1a64(canonicalInputsValue)}`;
}
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `bun test packages/live/test/instance-id.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/live packages/core
git commit -m "$(cat <<'EOF'
feat(live): add @Live decorator and structured instance identity

Scope is embedded literally in the instance id instead of hashed alongside
the inputs: a hash collision there would not cost CPU, it would show one
tenant another tenant's rows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ResourceRegistry` e coleta de dependência

Registra os resources, aplica as validações de startup da §5.6, e roda o compute
dentro do `AsyncLocalStorage` que coleta as dependências. O padrão de ALS é o
mesmo de `identityMapContext`, `tenantContext` e `transactionContext`.

**Files:**
- Create: `packages/live/src/resource/dependency-context.ts`
- Create: `packages/live/src/resource/ResourceRegistry.ts`
- Test: `packages/live/test/resource-registry.test.ts`

**Interfaces:**
- Consumes: `LiveResource`, `LiveInputs` (Task 6); `Dependency` (Task 2); `LIVE_META` (Task 6); `ROUTES_META`, `PARAMS_META`, `ParamMetadata` de `@carno.js/core`.
- Produces:
  - `class DependencyCollector { add(dep): void; addAll(deps): void; drain(): Dependency[] }`
  - `const dependencyContext` com `run<T>(fn): Promise<{ result: T; deps: Dependency[] }>`, `current(): DependencyCollector | undefined`, `isActive(): boolean`
  - `class LiveValidationError extends Error`
  - `class ResourceRegistry { register(ControllerClass, instance): void; get(id): LiveResource | undefined; ids(): string[]; compute(resource, inputs): Promise<{ data: unknown; deps: Dependency[] }> }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/resource-registry.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Controller, Ctx, Delete, Get, Param, Query, Req } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { dependencyContext } from '../src/resource/dependency-context';
import { LiveValidationError, ResourceRegistry } from '../src/resource/ResourceRegistry';

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id' })
    list(@Query('status') status: string) {
        dependencyContext.current()?.add({ key: 'orm:users', columns: ['status'] });
        return [{ id: 1, status }];
    }

    @Get('/:id')
    @Live()
    get(@Param('id') id: string) {
        dependencyContext.current()?.add({ key: `orm:users#${id}`, columns: null });
        return { id };
    }
}

@Controller('/bad')
class WritingController {
    @Delete('/:id')
    @Live()
    remove(@Param('id') id: string) {
        return { id };
    }
}

@Controller('/bad2')
class RequestController {
    @Get('/')
    @Live()
    read(@Req() req: unknown, @Ctx() ctx: unknown) {
        return { req, ctx };
    }
}

describe('ResourceRegistry.register', () => {
    test('registers every @Live handler under controller.handler', () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController());

        expect(registry.ids().sort()).toEqual(['UsersController.get', 'UsersController.list']);
        expect(registry.get('UsersController.list')?.meta.key).toBe('id');
    });

    test('refuses @Live on a verb that is not GET', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(WritingController, new WritingController()))
            .toThrow(LiveValidationError);
    });

    test('refuses request-bound parameters that break recomputability', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(RequestController, new RequestController()))
            .toThrow(/@Req\(\)/);
    });

    test('refuses two resources with the same id', () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController());

        expect(() => registry.register(UsersController, new UsersController()))
            .toThrow(/already registered/);
    });
});

describe('ResourceRegistry.compute', () => {
    test('resolves query and param arguments from inputs', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController());

        const list = await registry.compute(registry.get('UsersController.list')!, {
            params: {},
            query: { status: 'active' }
        });
        expect(list.data).toEqual([{ id: 1, status: 'active' }]);

        const one = await registry.compute(registry.get('UsersController.get')!, {
            params: { id: '42' },
            query: {}
        });
        expect(one.data).toEqual({ id: '42' });
    });

    test('collects the dependencies registered during the compute', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController());

        const result = await registry.compute(registry.get('UsersController.get')!, {
            params: { id: '42' },
            query: {}
        });

        expect(result.deps).toEqual([{ key: 'orm:users#42', columns: null }]);
    });

    test('seeds the collector with the declared dependsOn keys', async () => {
        @Controller('/reports')
        class ReportsController {
            @Get('/')
            @Live({ dependsOn: ['app:report:current'] })
            current() {
                return { ok: true };
            }
        }

        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController());

        const result = await registry.compute(registry.get('ReportsController.current')!, {
            params: {},
            query: {}
        });

        expect(result.deps).toEqual([{ key: 'app:report:current', columns: null }]);
    });

    test('the collector is inactive outside a compute', () => {
        expect(dependencyContext.isActive()).toBe(false);
        expect(dependencyContext.current()).toBeUndefined();
    });

    test('concurrent computes do not mix dependencies', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController());
        const resource = registry.get('UsersController.get')!;

        const [a, b] = await Promise.all([
            registry.compute(resource, { params: { id: '1' }, query: {} }),
            registry.compute(resource, { params: { id: '2' }, query: {} })
        ]);

        expect(a.deps).toEqual([{ key: 'orm:users#1', columns: null }]);
        expect(b.deps).toEqual([{ key: 'orm:users#2', columns: null }]);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/resource-registry.test.ts`
Expected: FAIL — `Cannot find module '../src/resource/dependency-context'`

- [ ] **Step 3: Implementar `dependency-context.ts`**

`packages/live/src/resource/dependency-context.ts`:

```ts
import { AsyncLocalStorage } from 'async_hooks';
import type { Dependency } from '../graph/types';

export class DependencyCollector {
    private readonly deps: Dependency[] = [];

    add(dep: Dependency): void {
        this.deps.push(dep);
    }

    addAll(deps: Dependency[]): void {
        for (const dep of deps) {
            this.deps.push(dep);
        }
    }

    drain(): Dependency[] {
        return this.deps.slice();
    }
}

/**
 * Collects the reads performed during one resource compute.
 *
 * Same AsyncLocalStorage shape as identityMapContext, tenantContext and
 * transactionContext in @carno.js/orm — concurrent computes each get their own
 * collector without threading a parameter through user code.
 */
class DependencyContext {
    private readonly storage = new AsyncLocalStorage<DependencyCollector>();

    async run<T>(fn: (collector: DependencyCollector) => Promise<T> | T): Promise<{ result: T; deps: Dependency[] }> {
        const collector = new DependencyCollector();
        const result = await this.storage.run(collector, async () => fn(collector));

        return { result, deps: collector.drain() };
    }

    current(): DependencyCollector | undefined {
        return this.storage.getStore();
    }

    isActive(): boolean {
        return this.storage.getStore() !== undefined;
    }
}

export const dependencyContext = new DependencyContext();
```

- [ ] **Step 4: Implementar `ResourceRegistry`**

`packages/live/src/resource/ResourceRegistry.ts`:

```ts
import 'reflect-metadata';
import { PARAMS_META, ROUTES_META, type ParamMetadata } from '@carno.js/core';
import type { Dependency } from '../graph/types';
import { LIVE_META, type LiveMeta } from '../metadata';
import { dependencyContext } from './dependency-context';
import type { LiveInputs, LiveResource } from './types';

/** Verbs that may carry @Live in phase 1. @Post() arrives with phase 2. */
const ALLOWED_METHODS = new Set(['get']);

/**
 * Parameters that would break "state is recomputable from inputs": there is no
 * Request, no header set and no middleware-populated locals during a recompute.
 */
const FORBIDDEN_PARAMS: Record<string, string> = {
    req: '@Req()',
    ctx: '@Ctx()',
    header: '@Header()',
    locals: '@Locals()'
};

export class LiveValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LiveValidationError';
    }
}

interface RouteInfoLike {
    method: string;
    path: string;
    handlerName: string;
}

export class ResourceRegistry {
    private readonly resources = new Map<string, LiveResource>();

    /**
     * Scan a controller for @Live handlers and validate them.
     *
     * Validation runs at registration, which is bootstrap time: the core
     * compiles everything at startup, so a misdeclared resource fails the boot
     * instead of failing the first subscription in production.
     */
    register(ControllerClass: new (...args: any[]) => any, instance: any): void {
        const routes: RouteInfoLike[] = Reflect.getMetadata(ROUTES_META, ControllerClass) || [];

        for (const route of routes) {
            const meta: LiveMeta | undefined = Reflect.getMetadata(
                LIVE_META,
                ControllerClass,
                route.handlerName
            );

            if (!meta) {
                continue;
            }

            const id = `${ControllerClass.name}.${route.handlerName}`;
            const where = `${ControllerClass.name}.${route.handlerName}()`;

            if (!ALLOWED_METHODS.has(route.method)) {
                throw new LiveValidationError(
                    `${where} is decorated with @Live() on @${route.method.toUpperCase()}(). ` +
                    `Subscribing means re-running the handler whenever the data changes, so it must be ` +
                    `idempotent. Phase 1 allows @Get() only; @Post() for read-only queries arrives in phase 2.`
                );
            }

            const params: ParamMetadata[] =
                Reflect.getMetadata(PARAMS_META, ControllerClass, route.handlerName) || [];

            for (const param of params) {
                const forbidden = FORBIDDEN_PARAMS[param.type];

                if (forbidden) {
                    throw new LiveValidationError(
                        `${where} uses ${forbidden}, which is not available during a recompute. ` +
                        `A live resource must be a pure function of its declared inputs.`
                    );
                }

                if (param.type === 'body') {
                    throw new LiveValidationError(
                        `${where} uses @Body(), which requires @Live() on @Post(). That arrives in phase 2.`
                    );
                }
            }

            if (meta.key !== undefined && (typeof meta.key !== 'string' || meta.key === '')) {
                throw new LiveValidationError(`${where} declares an empty @Live({ key }).`);
            }

            if (this.resources.has(id)) {
                throw new LiveValidationError(`Live resource "${id}" is already registered.`);
            }

            this.resources.set(id, {
                id,
                controllerName: ControllerClass.name,
                handlerName: route.handlerName,
                meta,
                params,
                invoke: (args: unknown[]) => Promise.resolve(instance[route.handlerName](...args))
            });
        }
    }

    get(id: string): LiveResource | undefined {
        return this.resources.get(id);
    }

    ids(): string[] {
        return [...this.resources.keys()];
    }

    /** Run the handler and report what it read. */
    async compute(
        resource: LiveResource,
        inputs: LiveInputs
    ): Promise<{ data: unknown; deps: Dependency[] }> {
        const args = buildArgs(resource.params, inputs);

        const { result, deps } = await dependencyContext.run(collector => {
            for (const key of resource.meta.dependsOn) {
                collector.add({ key, columns: null });
            }

            return resource.invoke(args);
        });

        return { data: result, deps };
    }
}

function buildArgs(params: ParamMetadata[], inputs: LiveInputs): unknown[] {
    if (params.length === 0) {
        return [];
    }

    const size = Math.max(...params.map(param => param.index)) + 1;
    const args = new Array<unknown>(size).fill(undefined);

    for (const param of params) {
        if (param.type === 'param') {
            args[param.index] = param.key ? inputs.params[param.key] : inputs.params;
        } else if (param.type === 'query') {
            args[param.index] = param.key ? inputs.query[param.key] : inputs.query;
        }
    }

    return args;
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `bun test packages/live/test/resource-registry.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add ResourceRegistry with startup validation and dep collection

Validation runs at registration, which is bootstrap: a misdeclared resource
fails the boot instead of failing the first subscription in production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Observador de `Statement` no ORM

A peça mais delicada do plano: toca o caminho quente de **toda** query da
aplicação. Por isso o hook é um pub/sub de três slots nulos, testável sozinho, e
a mudança no `SqlBuilder` cabe em quinze linhas.

Três decisões registradas no código, porque cada uma é um bug esperando:

1. A notificação de leitura vai **antes** do `shouldUseCache()`. Depois, um
   resource cujo primeiro compute pega cache nunca registraria dependência e
   nunca receberia patch.
2. A notificação de escrita vai **depois** da execução, para não invalidar por
   causa de uma escrita que falhou.
3. A guarda de "escrita durante compute" vai **antes** da execução, para abortar
   o efeito colateral em vez de reportá-lo.

**Files:**
- Create: `packages/orm/src/live/statement-observer.ts`
- Modify: `packages/orm/src/SqlBuilder.ts` — `execute()`
- Modify: `packages/orm/src/index.ts` — export
- Test: `packages/orm/test/live/statement-observer.spec.ts`

**Interfaces:**
- Consumes: `Statement<T>` (`packages/orm/src/driver/driver.interface.ts:232`).
- Produces:
  - `type StatementListener = (statement: Statement<any>) => void`
  - `const statementObserver` com `onRead`, `onWrite`, `onWriteAttempt`, `reset`, `notifyRead`, `notifyWrite`, `notifyWriteAttempt`

> Indentação de **2 espaços** nesta task — é `packages/orm`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/orm/test/live/statement-observer.spec.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import type { Statement } from '../../src/driver/driver.interface';
import { statementObserver } from '../../src/live/statement-observer';

const SELECT: Statement<any> = { statement: 'select', table: 'users' };
const UPDATE: Statement<any> = { statement: 'update', table: 'users' };

afterEach(() => {
  statementObserver.reset();
});

describe('statementObserver', () => {
  test('does nothing when no listener is registered', () => {
    expect(() => {
      statementObserver.notifyRead(SELECT);
      statementObserver.notifyWrite(UPDATE);
      statementObserver.notifyWriteAttempt(UPDATE);
    }).not.toThrow();
  });

  test('routes reads and writes to their own listeners', () => {
    const reads: Statement<any>[] = [];
    const writes: Statement<any>[] = [];

    statementObserver.onRead(statement => reads.push(statement));
    statementObserver.onWrite(statement => writes.push(statement));

    statementObserver.notifyRead(SELECT);
    statementObserver.notifyWrite(UPDATE);

    expect(reads).toEqual([SELECT]);
    expect(writes).toEqual([UPDATE]);
  });

  test('lets the write-attempt listener veto by throwing', () => {
    statementObserver.onWriteAttempt(() => {
      throw new Error('write during compute');
    });

    expect(() => statementObserver.notifyWriteAttempt(UPDATE)).toThrow('write during compute');
  });

  test('reset detaches every listener', () => {
    let calls = 0;
    statementObserver.onRead(() => { calls++; });
    statementObserver.reset();
    statementObserver.notifyRead(SELECT);

    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/orm/test/live/statement-observer.spec.ts`
Expected: FAIL — `Cannot find module '../../src/live/statement-observer'`

- [ ] **Step 3: Implementar o observador**

`packages/orm/src/live/statement-observer.ts` (2 espaços):

```ts
import type { Statement } from '../driver/driver.interface';

export type StatementListener = (statement: Statement<any>) => void;

/**
 * The single seam through which @carno.js/live observes the ORM.
 *
 * `SqlBuilder.execute()` is already the choke point every read and every write
 * passes through, so nothing else needs a hook. Each slot holds at most one
 * listener because the live package is the only intended consumer; keeping it
 * to three null checks per query keeps the hot path honest for applications
 * that never install it.
 */
class StatementObserver {
  private readListener: StatementListener | null = null;
  private writeListener: StatementListener | null = null;
  private writeAttemptListener: StatementListener | null = null;

  /** Called for every read, before the query cache is consulted. */
  onRead(listener: StatementListener | null): void {
    this.readListener = listener;
  }

  /** Called for every write that actually executed. */
  onWrite(listener: StatementListener | null): void {
    this.writeListener = listener;
  }

  /** Called before a write executes. Throwing here aborts the write. */
  onWriteAttempt(listener: StatementListener | null): void {
    this.writeAttemptListener = listener;
  }

  reset(): void {
    this.readListener = null;
    this.writeListener = null;
    this.writeAttemptListener = null;
  }

  notifyRead(statement: Statement<any>): void {
    if (this.readListener) {
      this.readListener(statement);
    }
  }

  notifyWrite(statement: Statement<any>): void {
    if (this.writeListener) {
      this.writeListener(statement);
    }
  }

  notifyWriteAttempt(statement: Statement<any>): void {
    if (this.writeAttemptListener) {
      this.writeAttemptListener(statement);
    }
  }
}

export const statementObserver = new StatementObserver();
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bun test packages/orm/test/live/statement-observer.spec.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Ligar o observador no `SqlBuilder`**

Em `packages/orm/src/SqlBuilder.ts`, adicionar o import junto aos outros
(depois de `import { escapeString } from './utils/sql-escape';`):

```ts
import { statementObserver } from './live/statement-observer';
```

Substituir o corpo de `execute()` (linhas ~416-449). O trecho atual é:

```ts
  async execute(): Promise<{ query: any; startTime: number; sql: string; affectedRows?: number }> {
    this.prepareColumns();
    this.statements.join = this.normalizeJoinOrder(this.statements.join);

    if (this.shouldUseCache()) {
      const cached = await this.getCachedResult();

      if (cached) {
        return cached;
      }
    }
```

Passa a ser:

```ts
  async execute(): Promise<{ query: any; startTime: number; sql: string; affectedRows?: number }> {
    this.prepareColumns();
    this.statements.join = this.normalizeJoinOrder(this.statements.join);

    const isWrite = this.isWriteOperation();

    if (isWrite) {
      // Throws when a live resource compute is on the stack: a resource reads,
      // an action writes. Runs before execution so the side effect is aborted,
      // not merely reported.
      statementObserver.notifyWriteAttempt(this.statements);
    } else {
      // Deliberately before the cache check: a read served from cache still has
      // to register its dependency, or a resource whose first compute hit the
      // cache would never be invalidated.
      statementObserver.notifyRead(this.statements);
    }

    if (this.shouldUseCache()) {
      const cached = await this.getCachedResult();

      if (cached) {
        return cached;
      }
    }
```

E o trecho final atual:

```ts
    if (this.isWriteOperation()) {
      await this.invalidateCache();
    }

    return result;
  }
```

Passa a ser:

```ts
    if (isWrite) {
      await this.invalidateCache();
      // After execution, so a failed write does not invalidate. A write rolled
      // back later by its transaction still notifies: the recompute produces
      // the same data and therefore no patch, so it costs CPU, never
      // correctness.
      statementObserver.notifyWrite(this.statements);
    }

    return result;
  }
```

- [ ] **Step 6: Exportar o observador**

Em `packages/orm/src/index.ts`, ao final, acrescentar:

```ts
export { statementObserver } from './live/statement-observer'
export type { StatementListener } from './live/statement-observer'
```

- [ ] **Step 7: Verificar que a suíte do ORM não regrediu**

Run: `docker-compose up -d && bun test packages/orm && docker-compose down`
Expected: mesmo resultado de antes da mudança. Se o ambiente não tiver Docker,
rodar ao menos `bun test packages/orm/test/live packages/orm/test/cache` e
registrar no commit que a suíte completa não foi executada.

- [ ] **Step 8: Verificar o build**

Run: `npx tsc -b -v --pretty false --force`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add packages/orm
git commit -m "$(cat <<'EOF'
feat(orm): expose a statement observer at the SqlBuilder choke point

Reads notify before the cache check so a cache hit still registers its
dependency; writes notify after execution so a failed write does not
invalidate; the write-attempt hook runs before execution so it can abort.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Bus de invalidação e `AppEmitter`

Liga o observador do ORM ao grafo. O `AppEmitter` é a primeira das três origens
de invalidação da §4.4; as outras duas (`PgNotifyEmitter`, `LiveService`) usam a
mesma interface e chegam na Fase 2.

Esta task inclui o **teste de integração com banco real** que valida a regex de
`extractRowIds` contra o `where` que o ORM realmente gera. Sem ele, a Task 2 está
testada apenas contra strings que eu escrevi.

**Files:**
- Create: `packages/live/src/bus/InvalidationBus.ts`
- Create: `packages/live/src/bus/InProcessBus.ts`
- Create: `packages/live/src/emitters/AppEmitter.ts`
- Test: `packages/live/test/app-emitter.test.ts`
- Test: `packages/live/test/orm-integration.test.ts`

**Interfaces:**
- Consumes: `statementObserver` (Task 8); `readDependencies`, `writeEvents` (Task 2); `dependencyContext` (Task 7); `LiveConfig` (Task 2).
- Produces:
  - `interface InvalidationBus { publish(events: InvalidationEvent[]): void; subscribe(handler: (events: InvalidationEvent[]) => void): () => void }`
  - `class InProcessBus implements InvalidationBus`
  - `class WriteDuringComputeError extends Error`
  - `class AppEmitter { constructor(bus, config); attach(): void; detach(): void }`

- [ ] **Step 1: Escrever o teste unitário que falha**

Criar `packages/live/test/app-emitter.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { statementObserver, type Statement } from '@carno.js/orm';
import { AppEmitter, WriteDuringComputeError } from '../src/emitters/AppEmitter';
import { InProcessBus } from '../src/bus/InProcessBus';
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { dependencyContext } from '../src/resource/dependency-context';
import type { InvalidationEvent } from '../src/graph/types';

afterEach(() => {
    statementObserver.reset();
});

function statement(overrides: Partial<Statement<any>>): Statement<any> {
    return { table: 'users', alias: 'u', primaryKeyColumnName: 'id', ...overrides };
}

describe('InProcessBus', () => {
    test('delivers published events to every subscriber', () => {
        const bus = new InProcessBus();
        const seen: InvalidationEvent[][] = [];
        bus.subscribe(events => seen.push(events));
        bus.subscribe(events => seen.push(events));

        bus.publish([{ key: 'orm:users', columns: null }]);

        expect(seen).toHaveLength(2);
    });

    test('unsubscribe stops delivery', () => {
        const bus = new InProcessBus();
        let calls = 0;
        const off = bus.subscribe(() => { calls++; });

        bus.publish([{ key: 'a', columns: null }]);
        off();
        bus.publish([{ key: 'a', columns: null }]);

        expect(calls).toBe(1);
    });

    test('one failing subscriber does not stop the others', () => {
        const bus = new InProcessBus();
        let reached = false;
        bus.subscribe(() => { throw new Error('boom'); });
        bus.subscribe(() => { reached = true; });

        bus.publish([{ key: 'a', columns: null }]);

        expect(reached).toBe(true);
    });
});

describe('AppEmitter', () => {
    test('feeds reads into the active dependency collector', async () => {
        const emitter = new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG);
        emitter.attach();

        const { deps } = await dependencyContext.run(() => {
            statementObserver.notifyRead(statement({ statement: 'select', where: 'u."id" = 42' }));
            return Promise.resolve(null);
        });

        expect(deps).toEqual([{ key: 'orm:users#42', columns: null }]);
    });

    test('drops reads that happen outside a compute', () => {
        const emitter = new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG);
        emitter.attach();

        expect(() => statementObserver.notifyRead(statement({ statement: 'select' }))).not.toThrow();
    });

    test('publishes an invalidation for a write', () => {
        const bus = new InProcessBus();
        const seen: InvalidationEvent[][] = [];
        bus.subscribe(events => seen.push(events));
        new AppEmitter(bus, DEFAULT_LIVE_CONFIG).attach();

        statementObserver.notifyWrite(statement({ statement: 'update', where: 'u."id" = 7', values: { name: 'x' } }));

        expect(seen).toEqual([[{ key: 'orm:users#7', columns: ['name'] }]]);
    });

    test('refuses a write attempted during a compute', async () => {
        new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG).attach();

        await dependencyContext.run(() => {
            expect(() => statementObserver.notifyWriteAttempt(statement({ statement: 'update' })))
                .toThrow(WriteDuringComputeError);
            return Promise.resolve(null);
        });
    });

    test('allows writes outside a compute', () => {
        new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG).attach();

        expect(() => statementObserver.notifyWriteAttempt(statement({ statement: 'update' }))).not.toThrow();
    });

    test('detach unhooks the observer', () => {
        const bus = new InProcessBus();
        let calls = 0;
        bus.subscribe(() => { calls++; });
        const emitter = new AppEmitter(bus, DEFAULT_LIVE_CONFIG);

        emitter.attach();
        emitter.detach();
        statementObserver.notifyWrite(statement({ statement: 'update', values: { a: 1 } }));

        expect(calls).toBe(0);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/app-emitter.test.ts`
Expected: FAIL — `Cannot find module '../src/emitters/AppEmitter'`

- [ ] **Step 3: Implementar o bus**

`packages/live/src/bus/InvalidationBus.ts`:

```ts
import type { InvalidationEvent } from '../graph/types';

export type InvalidationHandler = (events: InvalidationEvent[]) => void;

/**
 * Carries invalidations from an emitter to the nodes holding subscriptions.
 *
 * The graph does not care where an invalidation came from, which is why the
 * ORM emitter, the Postgres emitter and manual invalidation are three
 * implementations feeding one interface. Phase 1 ships the in-process one;
 * Redis and pg_notify buses arrive in phase 2 without touching the graph.
 */
export interface InvalidationBus {
    publish(events: InvalidationEvent[]): void;
    /** Returns an unsubscribe function. */
    subscribe(handler: InvalidationHandler): () => void;
}
```

`packages/live/src/bus/InProcessBus.ts`:

```ts
import type { InvalidationBus, InvalidationHandler } from './InvalidationBus';
import type { InvalidationEvent } from '../graph/types';

/** Single-process bus. Correct for one node; phase 2 adds the distributed ones. */
export class InProcessBus implements InvalidationBus {
    private readonly handlers = new Set<InvalidationHandler>();

    publish(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        for (const handler of this.handlers) {
            try {
                handler(events);
            } catch (error) {
                // One broken subscriber must not swallow invalidations for the
                // others: a dropped invalidation is a screen frozen on stale data.
                console.error('[carno:live] invalidation handler failed', error);
            }
        }
    }

    subscribe(handler: InvalidationHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
}
```

- [ ] **Step 4: Implementar `AppEmitter`**

`packages/live/src/emitters/AppEmitter.ts`:

```ts
import { statementObserver, type Statement } from '@carno.js/orm';
import type { InvalidationBus } from '../bus/InvalidationBus';
import type { LiveConfig } from '../config';
import { dependencyContext } from '../resource/dependency-context';
import { readDependencies, writeEvents } from './statement-keys';

export class WriteDuringComputeError extends Error {
    constructor(table: string | undefined, operation: string | undefined) {
        super(
            `A live resource compute attempted a ${operation ?? 'write'} on "${table ?? 'unknown'}". ` +
            `A resource reads; an action writes. Re-running the handler on every change would ` +
            `duplicate the side effect, so the write is refused.`
        );
        this.name = 'WriteDuringComputeError';
    }
}

/**
 * First of the three invalidation sources in §4.4: writes issued through
 * @carno.js/orm. Costs no infrastructure, and covers everything the
 * application itself writes.
 */
export class AppEmitter {
    constructor(
        private readonly bus: InvalidationBus,
        private readonly config: LiveConfig
    ) {}

    attach(): void {
        statementObserver.onRead((statement: Statement<any>) => {
            const collector = dependencyContext.current();

            if (!collector) {
                // A read outside any compute: an ordinary request. Nothing to record.
                return;
            }

            collector.addAll(readDependencies(statement, this.config.maxKeysPerRead));
        });

        statementObserver.onWriteAttempt((statement: Statement<any>) => {
            if (dependencyContext.isActive()) {
                throw new WriteDuringComputeError(statement.table, statement.statement);
            }
        });

        statementObserver.onWrite((statement: Statement<any>) => {
            this.bus.publish(writeEvents(statement, this.config.maxKeysPerRead));
        });
    }

    detach(): void {
        statementObserver.reset();
    }
}
```

- [ ] **Step 5: Rodar o teste unitário e ver passar**

Run: `bun test packages/live/test/app-emitter.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Escrever o teste de integração contra banco real**

Este é o teste que impede a Task 2 de estar certa só contra strings inventadas.

Criar `packages/live/test/orm-integration.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { Entity, PrimaryKey, Property, BaseEntity, statementObserver, type Statement } from '@carno.js/orm';
import { withDatabase } from '@carno.js/orm/testing/with-database';
import { readDependencies, writeEvents } from '../src/emitters/statement-keys';
import { DEFAULT_LIVE_CONFIG } from '../src/config';

const TABLE_STATEMENTS = [
    'CREATE TABLE live_users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, last_seen_at TIMESTAMP NULL);'
];

@Entity({ tableName: 'live_users' })
class LiveUser extends BaseEntity<LiveUser> {
    @PrimaryKey()
    id!: number;

    @Property()
    name!: string;

    @Property({ nullable: true })
    lastSeenAt?: Date;
}

afterEach(() => {
    statementObserver.reset();
});

describe('statement keys against real ORM output', () => {
    test('a findOne by primary key yields a row dependency', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const reads: Statement<any>[] = [];
            statementObserver.onRead(statement => reads.push(statement));

            const created = await LiveUser.create({ name: 'Ada' });
            await LiveUser.findOne({ id: created.id });

            const select = reads.find(statement => statement.statement === 'select');
            expect(select).toBeDefined();

            const deps = readDependencies(select!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);
            expect(deps[0].key).toBe(`orm:live_users#${created.id}`);
        });
    });

    test('a write emits the row key with the columns it wrote', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const writes: Statement<any>[] = [];
            statementObserver.onWrite(statement => writes.push(statement));

            const created = await LiveUser.create({ name: 'Ada' });
            await LiveUser.update({ id: created.id }, { name: 'Ada Lovelace' });

            const update = writes.find(statement => statement.statement === 'update');
            expect(update).toBeDefined();

            const events = writeEvents(update!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);
            expect(events[0].key).toBe(`orm:live_users#${created.id}`);
            expect(events[0].columns).toContain('name');
        });
    });

    test('the generated column list normalizes to bare column names', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const reads: Statement<any>[] = [];
            statementObserver.onRead(statement => reads.push(statement));

            await LiveUser.find({});

            const select = reads.find(statement => statement.statement === 'select');
            const deps = readDependencies(select!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);

            expect(deps[0].key).toBe('orm:live_users');
            expect(deps[0].columns).toEqual(expect.arrayContaining(['id', 'name']));
        });
    });
});
```

- [ ] **Step 7: Rodar o teste de integração**

```bash
docker-compose up -d
bun test packages/live/test/orm-integration.test.ts
docker-compose down
```

Expected: PASS — 3 tests.

**Se falhar por causa do formato do `where`,** o conserto é no regex de
`extractRowIds` em `packages/live/src/emitters/statement-keys.ts`, não no teste:
imprimir `select!.where` e ajustar o padrão para casar com a string real,
mantendo a exigência de que a cláusula seja **exatamente** uma igualdade de
chave primária. Se o formato real não for provável como igualdade de PK, a
função deve continuar devolvendo `null` e o resource degrada para a chave de
tabela — o teste então muda para asserir `orm:live_users`, e isso vira um risco
registrado no relatório da task.

Se a resolução de `@carno.js/orm/testing/with-database` falhar no Bun, trocar
por caminho relativo: `../../orm/src/testing/with-database`.

- [ ] **Step 8: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add invalidation bus and the ORM app emitter

Includes an integration test against a real database so the primary-key
detection is validated against the WHERE clause the ORM actually generates,
not only against hand-written strings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `LiveEngine`

Junta tudo: computa, hasheia, compara, e só então gera patch. Implementa as três
regras de comportamento sob carga da §4.5 e as guardas da §10.

**Files:**
- Create: `packages/live/src/shared/protocol.ts`
- Create: `packages/live/src/LiveEngine.ts`
- Test: `packages/live/test/live-engine.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 2-7 e 9.
- Produces:
  - Tipos de protocolo: `ClientMessage`, `ServerMessage` e suas variantes
  - `interface LiveTransport { send(connectionId: string, message: ServerMessage): number }`
  - `class LiveEngine` com
    `start(): void`, `stop(): void`,
    `subscribe(connectionId, sid, resourceId, inputs, scope): Promise<void>`,
    `unsubscribe(connectionId, sid): void`,
    `resync(connectionId, sid, clientHash?): Promise<void>`,
    `dropConnection(connectionId): void`,
    `invalidate(key: string): void`,
    `stats(): LiveStats`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/live-engine.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Controller, Get, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { DEFAULT_LIVE_CONFIG, resolveLiveConfig } from '../src/config';
import { DependencyGraph } from '../src/graph/DependencyGraph';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';
import { InProcessBus } from '../src/bus/InProcessBus';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { dependencyContext } from '../src/resource/dependency-context';
import { LiveEngine, type LiveTransport } from '../src/LiveEngine';
import type { ServerMessage } from '../src/shared/protocol';

const rows: { id: number; name: string; hits: number }[] = [];

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    list(@Query('q') q?: string) {
        dependencyContext.current()?.add({ key: 'orm:users', columns: ['id', 'name'] });
        return rows.filter(row => !q || row.name.includes(q)).map(row => ({ id: row.id, name: row.name }));
    }

    @Get('/private')
    @Live()
    mine() {
        dependencyContext.current()?.add({ key: 'orm:users', columns: null });
        return { ok: true };
    }
}

class FakeTransport implements LiveTransport {
    readonly sent: { connectionId: string; message: ServerMessage }[] = [];
    result = 1;

    send(connectionId: string, message: ServerMessage): number {
        this.sent.push({ connectionId, message });
        return this.result;
    }

    messagesFor(connectionId: string): ServerMessage[] {
        return this.sent.filter(entry => entry.connectionId === connectionId).map(entry => entry.message);
    }

    clear(): void {
        this.sent.length = 0;
    }
}

function build(overrides = {}) {
    const resources = new ResourceRegistry();
    resources.register(UsersController, new UsersController());

    const bus = new InProcessBus();
    const transport = new FakeTransport();
    const engine = new LiveEngine(
        resources,
        new DependencyGraph(),
        new SubscriptionRegistry(),
        bus,
        transport,
        resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 5, ...overrides })
    );
    engine.start();

    return { engine, bus, transport };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25));

beforeEach(() => {
    rows.length = 0;
    rows.push({ id: 1, name: 'Ada', hits: 0 });
});

describe('LiveEngine.subscribe', () => {
    test('answers a first subscription with a snapshot', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});

        const [message] = transport.messagesFor('c1');
        expect(message.t).toBe('snapshot');
        expect((message as any).data).toEqual([{ id: 1, name: 'Ada' }]);
        expect((message as any).hash).toMatch(/^[0-9a-f]{16}$/);
    });

    test('answers with current when the client hash already matches', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        const hash = (transport.messagesFor('c1')[0] as any).hash;
        transport.clear();

        await engine.subscribe('c2', 's1', 'UsersController.list', { params: {}, query: {} }, {}, hash);

        const [message] = transport.messagesFor('c2');
        expect(message.t).toBe('current');
        expect((message as any).data).toBeUndefined();
    });

    test('two connections with the same inputs and scope share one instance', async () => {
        const { engine } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c2', 's1', 'UsersController.list', { params: {}, query: {} }, {});

        expect(engine.stats().instances).toBe(1);
    });

    test('private scope keeps two principals apart', async () => {
        const { engine } = build();
        await engine.subscribe('c1', 's1', 'UsersController.mine', { params: {}, query: {} }, { principal: 1 });
        await engine.subscribe('c2', 's1', 'UsersController.mine', { params: {}, query: {} }, { principal: 2 });

        expect(engine.stats().instances).toBe(2);
    });

    test('rejects an unknown resource with an error message', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'Nope.nope', { params: {}, query: {} }, {});

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'error', code: 'unknown_resource' });
    });

    test('enforces the per-connection instance ceiling', async () => {
        const { engine, transport } = build({ maxInstancesPerConnection: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c1', 's2', 'UsersController.list', { params: {}, query: { q: 'A' } }, {});

        expect(transport.messagesFor('c1')[1]).toMatchObject({ t: 'error', code: 'too_many_instances' });
    });
});

describe('LiveEngine invalidation', () => {
    test('an invalidation that changes data produces a patch', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        const [message] = transport.messagesFor('c1');
        expect(message.t).toBe('patch');
        expect((message as any).ops).toEqual([
            { op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, name: 'Bob' } }
        ]);
        expect((message as any).from).toBe(1);
        expect((message as any).to).toBe(2);
    });

    test('a recompute that changes nothing sends nothing', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        expect(transport.sent).toHaveLength(0);
        expect(engine.stats().recomputesWithoutPatch).toBe(1);
    });

    test('a write to a column the resource does not read is ignored', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['last_seen_at'] }]);
        await settle();

        expect(transport.sent).toHaveLength(0);
        expect(engine.stats().recomputes).toBe(1);   // only the initial compute
    });

    test('coalesces a burst of invalidations into one patch', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        for (let i = 2; i <= 10; i++) {
            rows.push({ id: i, name: `U${i}`, hits: 0 });
            bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        }
        await settle();

        expect(transport.messagesFor('c1').filter(m => m.t === 'patch')).toHaveLength(1);
    });

    test('fans one patch out to every subscriber of the instance', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c2', 'sX', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'patch', sid: 's1' });
        expect(transport.messagesFor('c2')[0]).toMatchObject({ t: 'patch', sid: 'sX' });
    });

    test('sends a snapshot instead of a patch when the socket keeps back-pressuring', async () => {
        const { engine, bus, transport } = build({ maxPendingPatches: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();
        transport.result = -1;

        for (let i = 2; i <= 4; i++) {
            rows.push({ id: i, name: `U${i}`, hits: 0 });
            bus.publish([{ key: 'orm:users', columns: ['name'] }]);
            await settle();
        }

        expect(transport.messagesFor('c1').some(m => m.t === 'snapshot')).toBe(true);
    });

    test('reports stale when a recompute throws', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        const original = rows.filter;
        (rows as any).filter = () => { throw new Error('db down'); };
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();
        (rows as any).filter = original;

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'stale' });
    });
});

describe('LiveEngine lifecycle', () => {
    test('drops the instance only after the grace period', async () => {
        const { engine } = build({ unsubGraceMs: 30 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.unsubscribe('c1', 's1');

        expect(engine.stats().instances).toBe(1);
        await new Promise(resolve => setTimeout(resolve, 60));
        expect(engine.stats().instances).toBe(0);
    });

    test('resubscribing inside the grace period reuses the instance', async () => {
        const { engine, transport } = build({ unsubGraceMs: 50 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.unsubscribe('c1', 's1');
        transport.clear();

        await engine.subscribe('c1', 's2', 'UsersController.list', { params: {}, query: {} }, {});
        await new Promise(resolve => setTimeout(resolve, 80));

        expect(engine.stats().instances).toBe(1);
        expect(engine.stats().recomputes).toBe(1);
    });

    test('dropping a connection releases everything it held', async () => {
        const { engine } = build({ unsubGraceMs: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.dropConnection('c1');
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(engine.stats().instances).toBe(0);
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/live-engine.test.ts`
Expected: FAIL — `Cannot find module '../src/LiveEngine'`

- [ ] **Step 3: Implementar o protocolo**

`packages/live/src/shared/protocol.ts`:

```ts
import type { PatchOp } from '../patch/types';
import type { LiveInputs } from '../resource/types';

export const LIVE_PROTOCOL_VERSION = 1;

/** Sent once per connection, before any subscription. */
export interface ClientHello {
    t: 'hello';
    v: number;
    /** Opaque credential; the server's LiveScopeResolver interprets it. */
    token?: string;
}

export interface ClientSub {
    t: 'sub';
    /** Client-chosen subscription id. The instance id never leaves the server. */
    sid: string;
    resource: string;
    inputs: LiveInputs;
    /** Content hash of what the client already has on screen, if anything. */
    hash?: string;
}

export interface ClientUnsub {
    t: 'unsub';
    sid: string;
}

export interface ClientResync {
    t: 'resync';
    sid: string;
    hash?: string;
}

export type ClientMessage = ClientHello | ClientSub | ClientUnsub | ClientResync;

/** Full state. */
export interface ServerSnapshot {
    t: 'snapshot';
    sid: string;
    rev: number;
    hash: string;
    data: unknown;
    /**
     * The resource's `@Live({ key })`, if it declared one. The client needs it
     * to apply keyed ops, and this is the only message that establishes state,
     * so it is the only place it has to travel.
     */
    key?: string;
}

/** The client's hash matched what the server computed: nothing on the wire. */
export interface ServerCurrent {
    t: 'current';
    sid: string;
    rev: number;
    hash: string;
    /** Same reason as on `snapshot`: this also establishes state, on hydration. */
    key?: string;
}

export interface ServerPatch {
    t: 'patch';
    sid: string;
    from: number;
    to: number;
    hash: string;
    ops: PatchOp[];
}

/**
 * The server cannot vouch for this instance being current (a recompute is
 * failing). The client keeps showing the last data and flags it, so the UI can
 * say so.
 */
export interface ServerStale {
    t: 'stale';
    sid: string;
    reason: string;
}

/** The subscription is invalid or not allowed; the client ends the instance. */
export interface ServerError {
    t: 'error';
    sid: string;
    code: string;
    message: string;
}

export type ServerMessage = ServerSnapshot | ServerCurrent | ServerPatch | ServerStale | ServerError;
```

- [ ] **Step 4: Implementar `LiveEngine`**

`packages/live/src/LiveEngine.ts`:

```ts
import type { InvalidationBus } from './bus/InvalidationBus';
import type { LiveConfig } from './config';
import { DependencyGraph } from './graph/DependencyGraph';
import { SubscriptionRegistry } from './graph/SubscriptionRegistry';
import type { InvalidationEvent } from './graph/types';
import { PatchEngine } from './patch/PatchEngine';
import { canonical } from './shared/canonical';
import { fnv1a64 } from './shared/hash';
import type { ServerMessage } from './shared/protocol';
import {
    canonicalInputs,
    instanceIdOf,
    scopeKeyOf
} from './resource/instance-id';
import type { ResourceRegistry } from './resource/ResourceRegistry';
import type { LiveInputs, LiveResource, LiveScope } from './resource/types';

export interface LiveTransport {
    /**
     * Send one message. The return value is the underlying socket's: Bun's
     * `ServerWebSocket.send()` answers -1 under back-pressure and 0 when the
     * message was dropped. Anything <= 0 counts as back-pressure here.
     */
    send(connectionId: string, message: ServerMessage): number;
}

export interface LiveStats {
    instances: number;
    recomputes: number;
    /**
     * Recomputes that produced no patch. The most important number in the
     * system: it measures the precision of the invalidation granularity
     * directly. Climbing means the graph is waking instances for nothing.
     */
    recomputesWithoutPatch: number;
}

interface LiveInstance {
    id: string;
    resource: LiveResource;
    inputs: LiveInputs;
    patcher: PatchEngine;
    data: unknown;
    hash: string;
    revision: number;
    computing: Promise<void> | null;
    dirty: boolean;
    dropTimer: ReturnType<typeof setTimeout> | null;
}

export class LiveEngine {
    private readonly instances = new Map<string, LiveInstance>();
    /** connectionId → sid → instanceId. Addressing only; refcount lives in the registry. */
    private readonly bindings = new Map<string, Map<string, string>>();
    private readonly backpressure = new Map<string, number>();
    private readonly pending = new Set<string>();

    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeBus: (() => void) | null = null;
    private recomputes = 0;
    private recomputesWithoutPatch = 0;

    constructor(
        private readonly resources: ResourceRegistry,
        private readonly graph: DependencyGraph,
        private readonly subs: SubscriptionRegistry,
        private readonly bus: InvalidationBus,
        private readonly transport: LiveTransport,
        private readonly config: LiveConfig
    ) {}

    start(): void {
        if (this.unsubscribeBus) {
            return;
        }

        this.unsubscribeBus = this.bus.subscribe(events => this.onInvalidation(events));
    }

    stop(): void {
        this.unsubscribeBus?.();
        this.unsubscribeBus = null;

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        for (const instance of this.instances.values()) {
            if (instance.dropTimer) {
                clearTimeout(instance.dropTimer);
            }
        }
    }

    async subscribe(
        connectionId: string,
        sid: string,
        resourceId: string,
        inputs: LiveInputs,
        scope: LiveScope,
        clientHash?: string
    ): Promise<void> {
        const resource = this.resources.get(resourceId);

        if (!resource) {
            this.fail(connectionId, sid, 'unknown_resource', `No live resource named "${resourceId}".`);
            return;
        }

        let instanceId: string;

        try {
            const scopeKey = scopeKeyOf(resource.meta.shared, scope);
            instanceId = instanceIdOf(resource.id, scopeKey, canonicalInputs(inputs, this.config.maxInputBytes));
        } catch (error) {
            this.fail(connectionId, sid, 'invalid_subscription', (error as Error).message);
            return;
        }

        const known = this.instances.has(instanceId);
        const heldByConnection = this.subs.countForConnection(connectionId);

        if (!this.bindings.get(connectionId)?.has(sid) && heldByConnection >= this.config.maxInstancesPerConnection) {
            this.fail(
                connectionId,
                sid,
                'too_many_instances',
                `A connection may hold at most ${this.config.maxInstancesPerConnection} live instances.`
            );
            return;
        }

        if (!known && this.instances.size >= this.config.maxInstancesPerNode) {
            this.fail(connectionId, sid, 'node_at_capacity', 'This node is at its live instance ceiling.');
            return;
        }

        this.bind(connectionId, sid, instanceId);
        this.subs.subscribe(connectionId, instanceId);

        let instance = this.instances.get(instanceId);

        if (instance?.dropTimer) {
            clearTimeout(instance.dropTimer);
            instance.dropTimer = null;
        }

        if (!instance) {
            try {
                instance = await this.createInstance(instanceId, resource, inputs);
            } catch (error) {
                this.release(connectionId, sid);
                this.fail(connectionId, sid, 'compute_failed', (error as Error).message);
                return;
            }
        }

        this.sendState(connectionId, sid, instance, clientHash);
    }

    unsubscribe(connectionId: string, sid: string): void {
        this.release(connectionId, sid);
    }

    async resync(connectionId: string, sid: string, clientHash?: string): Promise<void> {
        const instanceId = this.bindings.get(connectionId)?.get(sid);
        const instance = instanceId ? this.instances.get(instanceId) : undefined;

        if (!instance) {
            this.fail(connectionId, sid, 'unknown_subscription', 'Resync for a subscription this node does not hold.');
            return;
        }

        this.sendState(connectionId, sid, instance, clientHash);
    }

    dropConnection(connectionId: string): void {
        const owned = this.bindings.get(connectionId);

        if (owned) {
            for (const sid of [...owned.keys()]) {
                this.release(connectionId, sid);
            }
        }

        this.bindings.delete(connectionId);
        this.backpressure.delete(connectionId);
    }

    /** Manual invalidation — the third emitter of §4.4. */
    invalidate(key: string): void {
        this.bus.publish([{ key, columns: null }]);
    }

    stats(): LiveStats {
        return {
            instances: this.instances.size,
            recomputes: this.recomputes,
            recomputesWithoutPatch: this.recomputesWithoutPatch
        };
    }

    // ------------------------------------------------------------ internals

    private bind(connectionId: string, sid: string, instanceId: string): void {
        let owned = this.bindings.get(connectionId);

        if (!owned) {
            owned = new Map<string, string>();
            this.bindings.set(connectionId, owned);
        }

        owned.set(sid, instanceId);
    }

    private release(connectionId: string, sid: string): void {
        const owned = this.bindings.get(connectionId);
        const instanceId = owned?.get(sid);

        if (!owned || !instanceId) {
            return;
        }

        owned.delete(sid);
        this.subs.unsubscribe(connectionId, instanceId);

        if (this.subs.hasSubscribers(instanceId)) {
            return;
        }

        const instance = this.instances.get(instanceId);

        if (!instance || instance.dropTimer) {
            return;
        }

        // Grace period so coming back from a navigation does not recompute
        // everything the page had a moment ago.
        instance.dropTimer = setTimeout(() => {
            if (!this.subs.hasSubscribers(instanceId)) {
                this.instances.delete(instanceId);
                this.graph.remove(instanceId);
            }
        }, this.config.unsubGraceMs);
    }

    private async createInstance(
        instanceId: string,
        resource: LiveResource,
        inputs: LiveInputs
    ): Promise<LiveInstance> {
        const { data, deps } = await this.resources.compute(resource, inputs);
        this.recomputes++;
        this.graph.setDependencies(instanceId, deps);

        const instance: LiveInstance = {
            id: instanceId,
            resource,
            inputs,
            patcher: new PatchEngine(resource.meta.key),
            data,
            hash: fnv1a64(canonical(data)),
            revision: 1,
            computing: null,
            dirty: false,
            dropTimer: null
        };

        this.instances.set(instanceId, instance);
        return instance;
    }

    private sendState(
        connectionId: string,
        sid: string,
        instance: LiveInstance,
        clientHash?: string
    ): void {
        if (clientHash && clientHash === instance.hash) {
            // The screen already holds this exact content. Nothing on the wire.
            this.send(connectionId, {
                t: 'current',
                sid,
                rev: instance.revision,
                hash: instance.hash,
                key: instance.resource.meta.key
            });
            return;
        }

        this.send(connectionId, {
            t: 'snapshot',
            sid,
            rev: instance.revision,
            hash: instance.hash,
            data: instance.data,
            key: instance.resource.meta.key
        });
    }

    private onInvalidation(events: InvalidationEvent[]): void {
        for (const event of events) {
            for (const instanceId of this.graph.resolve(event)) {
                if (this.subs.hasSubscribers(instanceId)) {
                    this.pending.add(instanceId);
                }
            }
        }

        if (this.pending.size === 0 || this.flushTimer) {
            return;
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, this.config.coalesceMs);
    }

    private async flush(): Promise<void> {
        const batch = [...this.pending];
        this.pending.clear();

        for (let i = 0; i < batch.length; i += this.config.fanoutQueueThreshold) {
            const slice = batch.slice(i, i + this.config.fanoutQueueThreshold);
            await Promise.all(slice.map(instanceId => this.recompute(instanceId)));

            if (i + this.config.fanoutQueueThreshold < batch.length) {
                // Yield between slices so a large fan-out does not monopolise
                // the loop and stall unrelated requests.
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }

    private recompute(instanceId: string): Promise<void> {
        const instance = this.instances.get(instanceId);

        if (!instance) {
            return Promise.resolve();
        }

        if (instance.computing) {
            // Single-flight: N invalidations arriving during one recompute cost
            // exactly one more recompute, not N.
            instance.dirty = true;
            return instance.computing;
        }

        instance.computing = this.runCompute(instance).finally(() => {
            instance.computing = null;

            if (instance.dirty) {
                instance.dirty = false;
                void this.recompute(instanceId);
            }
        });

        return instance.computing;
    }

    private async runCompute(instance: LiveInstance): Promise<void> {
        let data: unknown;
        let deps;

        try {
            ({ data, deps } = await this.resources.compute(instance.resource, instance.inputs));
        } catch (error) {
            this.broadcast(instance, sid => ({ t: 'stale', sid, reason: (error as Error).message }));
            return;
        }

        this.recomputes++;
        this.graph.setDependencies(instance.id, deps);

        const hash = fnv1a64(canonical(data));

        if (hash === instance.hash) {
            // Recompute is not a patch. Coarse invalidation costs CPU, never
            // traffic and never a re-render.
            this.recomputesWithoutPatch++;
            return;
        }

        const ops = instance.patcher.diff(instance.data, data);
        const from = instance.revision;

        instance.data = data;
        instance.hash = hash;
        instance.revision += 1;

        this.broadcast(instance, sid => ({
            t: 'patch',
            sid,
            from,
            to: instance.revision,
            hash,
            ops
        }));
    }

    private broadcast(instance: LiveInstance, build: (sid: string) => ServerMessage): void {
        for (const connectionId of this.subs.connectionsOf(instance.id)) {
            for (const sid of this.sidsFor(connectionId, instance.id)) {
                const message = build(sid);

                if (message.t === 'patch' && this.isBackedUp(connectionId)) {
                    // The client is behind. Collapse instead of queueing more.
                    this.send(connectionId, {
                        t: 'snapshot',
                        sid,
                        rev: instance.revision,
                        hash: instance.hash,
                        data: instance.data,
                        key: instance.resource.meta.key
                    });
                    this.backpressure.set(connectionId, 0);
                    continue;
                }

                this.send(connectionId, message);
            }
        }
    }

    private sidsFor(connectionId: string, instanceId: string): string[] {
        const owned = this.bindings.get(connectionId);

        if (!owned) {
            return [];
        }

        const sids: string[] = [];

        for (const [sid, boundInstance] of owned) {
            if (boundInstance === instanceId) {
                sids.push(sid);
            }
        }

        return sids;
    }

    private isBackedUp(connectionId: string): boolean {
        return (this.backpressure.get(connectionId) ?? 0) >= this.config.maxPendingPatches;
    }

    private send(connectionId: string, message: ServerMessage): void {
        const result = this.transport.send(connectionId, message);
        const current = this.backpressure.get(connectionId) ?? 0;

        this.backpressure.set(connectionId, result > 0 ? 0 : current + 1);
    }

    private fail(connectionId: string, sid: string, code: string, message: string): void {
        this.send(connectionId, { t: 'error', sid, code, message });
    }
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `bun test packages/live/test/live-engine.test.ts`
Expected: PASS — 15 tests.

Se `sends a snapshot instead of a patch when the socket keeps back-pressuring`
falhar, conferir que `maxPendingPatches: 1` faz o contador chegar ao limite na
segunda rodada: o primeiro `send` com `result = -1` incrementa para 1, e a
rodada seguinte já vê `isBackedUp`.

- [ ] **Step 6: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add LiveEngine with coalescing, single-flight and hash gating

A recompute whose content hash is unchanged sends nothing, so coarse
invalidation costs CPU and never traffic. The rate of those is the metric
that tells us whether the granularity is wrong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Transporte, escopo e plugin

Liga o motor ao WebSocket e monta o subsistema. É aqui que a limitação de slot
único do core (ver acima) obriga o `LivePlugin` a construir o
`WebSocketPlugin` em vez de coexistir com ele.

**Files:**
- Create: `packages/live/src/runtime.ts`
- Create: `packages/live/src/transport/SocketTransport.ts`
- Create: `packages/live/src/transport/scope-resolver.ts`
- Create: `packages/live/src/transport/LiveGateway.ts`
- Create: `packages/live/src/LiveService.ts`
- Create: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/index.ts` — superfície pública
- Test: `packages/live/test/transport.test.ts`

**Interfaces:**
- Consumes: `LiveEngine`, `LiveTransport`, `ServerMessage`, `ClientMessage` (Task 10); `ResourceRegistry` (Task 7); `AppEmitter` (Task 9); `CarnoSocket`, `Gateway`, `OnOpen`, `OnMessage`, `OnClose`, `WebSocketPlugin` de `@carno.js/websocket`.
- Produces:
  - `class SocketTransport implements LiveTransport` com `add(socket)`, `remove(id)`, `send(id, message): number`
  - `interface LiveHandshake { connectionId: string; token?: string }`
  - `interface LiveScopeResolver { resolve(handshake): LiveScope | Promise<LiveScope> }`
  - `class ConnectionScopeResolver implements LiveScopeResolver`
  - `class LiveGateway`
  - `class LiveService { invalidate(key: string): void }`
  - `class LivePlugin { static create(options: LivePluginOptions): Carno }`

O `LiveRuntime` é um holder de módulo, no mesmo padrão de `Orm.getInstance()`
que o repositório já usa. Poderia ser DI, mas o container do core não tem
`useFactory` e o gateway é instanciado por ele: o holder evita uma dança de
registro que só existiria para satisfazer o container.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/transport.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { SocketTransport } from '../src/transport/SocketTransport';
import { ConnectionScopeResolver } from '../src/transport/scope-resolver';
import type { ServerMessage } from '../src/shared/protocol';

class FakeSocket {
    sent: string[] = [];
    result = 7;

    constructor(public readonly id: string) {}

    send(message: string): number {
        this.sent.push(message);
        return this.result;
    }
}

const MESSAGE: ServerMessage = { t: 'stale', sid: 's1', reason: 'test' };

describe('SocketTransport', () => {
    test('serializes the message to the registered socket', () => {
        const transport = new SocketTransport();
        const socket = new FakeSocket('c1');
        transport.add(socket as any);

        expect(transport.send('c1', MESSAGE)).toBe(7);
        expect(JSON.parse(socket.sent[0])).toEqual(MESSAGE as any);
    });

    test('reports a dropped send for an unknown connection', () => {
        expect(new SocketTransport().send('ghost', MESSAGE)).toBe(0);
    });

    test('reports a dropped send when the socket throws', () => {
        const transport = new SocketTransport();
        transport.add({ id: 'c1', send: () => { throw new Error('closed'); } } as any);

        expect(transport.send('c1', MESSAGE)).toBe(0);
    });

    test('remove stops delivery', () => {
        const transport = new SocketTransport();
        const socket = new FakeSocket('c1');
        transport.add(socket as any);
        transport.remove('c1');

        expect(transport.send('c1', MESSAGE)).toBe(0);
    });
});

describe('ConnectionScopeResolver', () => {
    test('makes each connection its own principal, which shares nothing', async () => {
        const resolver = new ConnectionScopeResolver();

        expect(await resolver.resolve({ connectionId: 'c1' })).toEqual({ principal: 'c1' });
        expect(await resolver.resolve({ connectionId: 'c2' })).toEqual({ principal: 'c2' });
    });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/transport.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/SocketTransport'`

- [ ] **Step 3: Implementar transporte e resolver de escopo**

`packages/live/src/transport/SocketTransport.ts`:

```ts
import type { CarnoSocket } from '@carno.js/websocket';
import type { LiveTransport } from '../LiveEngine';
import type { ServerMessage } from '../shared/protocol';

/**
 * Sends protocol messages over the raw socket.
 *
 * We use `socket.send()` rather than `socket.emit()` because emit wraps the
 * payload in `{ event, data }` for the gateway's own event protocol, and this
 * is a different protocol.
 */
export class SocketTransport implements LiveTransport {
    private readonly sockets = new Map<string, CarnoSocket>();

    add(socket: CarnoSocket): void {
        this.sockets.set(socket.id, socket);
    }

    remove(connectionId: string): void {
        this.sockets.delete(connectionId);
    }

    /** <= 0 means back-pressured or dropped; the engine counts those. */
    send(connectionId: string, message: ServerMessage): number {
        const socket = this.sockets.get(connectionId);

        if (!socket) {
            return 0;
        }

        try {
            return socket.send(JSON.stringify(message));
        } catch {
            // The socket closed between fan-out and send. Treat as dropped;
            // the close handler will clean it up.
            return 0;
        }
    }
}
```

`packages/live/src/transport/scope-resolver.ts`:

```ts
import type { LiveScope } from '../shared/inputs';

export interface LiveHandshake {
    connectionId: string;
    /** Opaque credential from the client's `hello`. */
    token?: string;
}

export interface LiveScopeResolver {
    resolve(handshake: LiveHandshake): LiveScope | Promise<LiveScope>;
}

/**
 * Default resolver: every connection is its own principal.
 *
 * Safe by construction — nothing is ever shared between connections, so no
 * application can leak one user's data to another by forgetting to configure
 * this. Applications that want `shared: 'tenant'` or a real user identity
 * replace it.
 */
export class ConnectionScopeResolver implements LiveScopeResolver {
    resolve(handshake: LiveHandshake): LiveScope {
        return { principal: handshake.connectionId };
    }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bun test packages/live/test/transport.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Implementar o runtime e o gateway**

`packages/live/src/runtime.ts`:

```ts
import type { LiveEngine } from './LiveEngine';
import type { SocketTransport } from './transport/SocketTransport';
import type { LiveScopeResolver } from './transport/scope-resolver';
import type { LiveScope } from './shared/inputs';

export interface LiveRuntime {
    engine: LiveEngine;
    transport: SocketTransport;
    resolver: LiveScopeResolver;
    scopes: Map<string, LiveScope>;
}

let current: LiveRuntime | null = null;

/**
 * Process-wide holder, same shape as `Orm.getInstance()`.
 *
 * The gateway is instantiated by the core container, which has no factory
 * providers, so constructor-injecting a hand-built engine would need a
 * registration dance that exists only to satisfy the container.
 */
export function setLiveRuntime(runtime: LiveRuntime): void {
    current = runtime;
}

export function getLiveRuntime(): LiveRuntime {
    if (!current) {
        throw new Error('[carno:live] LivePlugin.create() has not run yet.');
    }

    return current;
}

export function resetLiveRuntime(): void {
    current = null;
}
```

`packages/live/src/transport/LiveGateway.ts`:

```ts
import { CarnoSocket, Gateway, OnClose, OnMessage, OnOpen } from '@carno.js/websocket';
import { getLiveRuntime } from '../runtime';
import type { ClientMessage } from '../shared/protocol';

export const LIVE_GATEWAY_PATH = '/live';

@Gateway(LIVE_GATEWAY_PATH)
export class LiveGateway {
    @OnOpen()
    onOpen(socket: CarnoSocket): void {
        const runtime = getLiveRuntime();
        runtime.transport.add(socket);
        // Until a `hello` arrives, the connection is its own principal: safe,
        // shares nothing.
        runtime.scopes.set(socket.id, { principal: socket.id });
    }

    @OnMessage()
    onMessage(socket: CarnoSocket, raw: string | ArrayBuffer | Uint8Array): void {
        if (typeof raw !== 'string') {
            return;
        }

        void handleMessage(socket.id, raw);
    }

    @OnClose()
    onClose(socket: CarnoSocket): void {
        const runtime = getLiveRuntime();
        runtime.engine.dropConnection(socket.id);
        runtime.transport.remove(socket.id);
        runtime.scopes.delete(socket.id);
    }
}

export async function handleMessage(connectionId: string, raw: string): Promise<void> {
    const runtime = getLiveRuntime();

    let message: ClientMessage;

    try {
        message = JSON.parse(raw) as ClientMessage;
    } catch {
        return;
    }

    if (!message || typeof (message as { t?: unknown }).t !== 'string') {
        return;
    }

    switch (message.t) {
        case 'hello': {
            const scope = await runtime.resolver.resolve({ connectionId, token: message.token });
            runtime.scopes.set(connectionId, scope);
            return;
        }

        case 'sub': {
            const scope = runtime.scopes.get(connectionId) ?? { principal: connectionId };
            await runtime.engine.subscribe(
                connectionId,
                message.sid,
                message.resource,
                { params: message.inputs?.params ?? {}, query: message.inputs?.query ?? {} },
                scope,
                message.hash
            );
            return;
        }

        case 'unsub':
            runtime.engine.unsubscribe(connectionId, message.sid);
            return;

        case 'resync':
            await runtime.engine.resync(connectionId, message.sid, message.hash);
            return;
    }
}
```

- [ ] **Step 6: Implementar `LiveService` e `LivePlugin`**

`packages/live/src/LiveService.ts`:

```ts
import { Service } from '@carno.js/core';
import { getLiveRuntime } from './runtime';

/**
 * Manual invalidation — the third emitter of §4.4, for data the ORM cannot
 * see: a rebuilt report, a webhook, an external cache.
 *
 * @example
 * ```ts
 * @Service()
 * export class ReportJob {
 *     constructor(private readonly live: LiveService) {}
 *
 *     @Cron('0 * * * *')
 *     async run() {
 *         await this.rebuild();
 *         this.live.invalidate('app:report:current');
 *     }
 * }
 * ```
 */
@Service()
export class LiveService {
    invalidate(key: string): void {
        getLiveRuntime().engine.invalidate(key);
    }
}
```

`packages/live/src/LivePlugin.ts`:

```ts
import { Carno, type Container } from '@carno.js/core';
import { WebSocketPlugin, type WebSocketPluginConfig } from '@carno.js/websocket';
import { InProcessBus } from './bus/InProcessBus';
import { resolveLiveConfig, type LiveConfig } from './config';
import { AppEmitter } from './emitters/AppEmitter';
import { DependencyGraph } from './graph/DependencyGraph';
import { SubscriptionRegistry } from './graph/SubscriptionRegistry';
import { LiveEngine } from './LiveEngine';
import { LiveService } from './LiveService';
import { ResourceRegistry } from './resource/ResourceRegistry';
import { setLiveRuntime } from './runtime';
import { LiveGateway } from './transport/LiveGateway';
import { ConnectionScopeResolver, type LiveScopeResolver } from './transport/scope-resolver';
import { SocketTransport } from './transport/SocketTransport';

export interface LivePluginOptions {
    /** Controllers holding @Live() handlers. Validated at bootstrap. */
    controllers: (new (...args: any[]) => any)[];
    /**
     * Your own @Gateway classes. They must be listed here rather than passed to
     * a second WebSocketPlugin: Carno.use() keeps only one WebSocket handler
     * builder, so a second plugin silently wins and orphans the first.
     */
    gateways?: (new (...args: any[]) => any)[];
    scopeResolver?: LiveScopeResolver;
    config?: Partial<LiveConfig>;
    websocket?: WebSocketPluginConfig;
}

export class LivePlugin {
    static create(options: LivePluginOptions): Carno {
        const config = resolveLiveConfig(options.config);
        const resources = new ResourceRegistry();
        const graph = new DependencyGraph();
        const subs = new SubscriptionRegistry();
        const bus = new InProcessBus();
        const transport = new SocketTransport();
        const engine = new LiveEngine(resources, graph, subs, bus, transport, config);
        const emitter = new AppEmitter(bus, config);

        setLiveRuntime({
            engine,
            transport,
            resolver: options.scopeResolver ?? new ConnectionScopeResolver(),
            scopes: new Map()
        });

        const plugin = new Carno({ exports: [] });
        plugin.services([LiveService]);

        const websocket = WebSocketPlugin.create(
            [LiveGateway, ...(options.gateways ?? [])],
            options.websocket
        );

        const innerBuilder = websocket._wsHandlerBuilder!;
        const upgradePaths = [...websocket._wsUpgradePaths];

        plugin.use(websocket);

        // The builder runs after bootstrap, when the container holds the
        // controller instances — the same hook WebSocketPlugin uses.
        plugin.wsHandler((container: Container) => {
            for (const ControllerClass of options.controllers) {
                resources.register(ControllerClass, container.get(ControllerClass));
            }

            emitter.attach();
            engine.start();

            return innerBuilder(container);
        }, upgradePaths);

        return plugin;
    }
}
```

- [ ] **Step 7: Publicar a superfície do pacote**

Substituir `packages/live/src/index.ts` inteiro por:

```ts
import 'reflect-metadata';

// Decorator and metadata
export { Live } from './decorators/Live';
export { LIVE_META } from './metadata';
export type { LiveMeta, LiveOptions, LiveShared } from './metadata';

// Plugin and services
export { LivePlugin } from './LivePlugin';
export type { LivePluginOptions } from './LivePlugin';
export { LiveService } from './LiveService';
export { LiveEngine } from './LiveEngine';
export type { LiveTransport, LiveStats } from './LiveEngine';

// Configuration
export { DEFAULT_LIVE_CONFIG, resolveLiveConfig } from './config';
export type { LiveConfig } from './config';

// Scope
export { ConnectionScopeResolver } from './transport/scope-resolver';
export type { LiveHandshake, LiveScopeResolver } from './transport/scope-resolver';
export type { LiveInputs, LiveScope } from './shared/inputs';

// Invalidation
export { InProcessBus } from './bus/InProcessBus';
export type { InvalidationBus, InvalidationHandler } from './bus/InvalidationBus';
export type { Dependency, InvalidationEvent } from './graph/types';
export { ancestorsOf, rowKey, tableKey } from './graph/dep-key';
export type { DepKey } from './graph/dep-key';
export { WriteDuringComputeError } from './emitters/AppEmitter';

// Protocol and patches, shared with the client
export * from './shared/protocol';
export type { PatchOp, PathSegment } from './patch/types';
export { PatchEngine } from './patch/PatchEngine';
export { canonical, NonSerializableInputError } from './shared/canonical';
export { fnv1a64 } from './shared/hash';
```

- [ ] **Step 8: Verificar build e suíte do pacote**

Run: `npx tsc -b -v --pretty false --force && bun test packages/live`
Expected: build limpo; todos os testes do pacote passando.

Se `websocket._wsHandlerBuilder` acusar erro de tipo por ser propriedade sem
declaração pública, o campo existe em `packages/core/src/Carno.ts:91` como
`_wsHandlerBuilder: ((container: Container) => any) | null` — se o `tsc` reclamar
de acesso, usar `(websocket as any)._wsHandlerBuilder` e registrar isso como
dívida a resolver quando o core ganhar suporte a múltiplos builders.

- [ ] **Step 9: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add socket transport, live gateway and LivePlugin

LivePlugin builds the WebSocketPlugin itself because Carno.use() keeps only
one WebSocket handler builder: a second plugin silently wins and orphans the
first, upgrading connections into a gateway that no longer exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Núcleo do cliente

Agnóstico de framework. Cuida de conexão, protocolo, revisões, resync, dedupe
por refcount, otimismo (fora da Fase 1) e o handshake por hash. Expõe exatamente
a assinatura que `useSyncExternalStore` quer — se um adapter crescer, é sinal de
lógica vazando daqui.

**Files:**
- Create: `packages/live/src/client/core.ts`
- Test: `packages/live/test/client-core.test.ts`

**Interfaces:**
- Consumes: `canonical`, `fnv1a64`, `PatchEngine`, tipos de protocolo.
- Produces:
  - `interface LiveState<T> { data: T | undefined; pending: boolean; error: string | null; stale: boolean }`
  - `interface LiveStore<T> { subscribe(listener: () => void): () => void; getSnapshot(): LiveState<T> }`
  - `interface LiveSocket` — a fatia de `WebSocket` que usamos, e o ponto de injeção nos testes
  - `interface LiveClientOptions`
  - `class LiveClient { store<T>(resource, inputs): LiveStore<T>; close(): void }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/live/test/client-core.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';

class FakeSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    readonly sent: ClientMessage[] = [];
    closed = false;

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.closed = true;
        this.onclose?.();
    }

    open(): void {
        this.onopen?.();
    }

    deliver(message: ServerMessage): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }

    subs(): Extract<ClientMessage, { t: 'sub' }>[] {
        return this.sent.filter(m => m.t === 'sub') as any;
    }
}

function build(options: Partial<ConstructorParameters<typeof LiveClient>[0]> = {}) {
    const socket = new FakeSocket();
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => socket,
        unsubGraceMs: 5,
        ...options
    });

    return { client, socket };
}

describe('LiveClient store', () => {
    test('starts pending and subscribes on open', () => {
        const { client, socket } = build();
        const store = client.store('UsersController.list', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        expect(store.getSnapshot().pending).toBe(true);
        expect(socket.subs()[0]).toMatchObject({ resource: 'UsersController.list' });
    });

    test('a snapshot fills the store and clears pending', () => {
        const { client, socket } = build();
        const store = client.store<{ id: number }[]>('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: [{ id: 1 }], key: 'id' });

        expect(store.getSnapshot()).toMatchObject({ pending: false, error: null, stale: false });
        expect(store.getSnapshot().data).toEqual([{ id: 1 }]);
    });

    test('getSnapshot is referentially stable until something changes', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: { a: 1 } });

        const first = store.getSnapshot();
        expect(store.getSnapshot()).toBe(first);

        socket.deliver({ t: 'patch', sid: socket.subs()[0].sid, from: 1, to: 2, hash: 'h2', ops: [{ op: 'set', path: ['a'], value: 2 }] });

        expect(store.getSnapshot()).not.toBe(first);
        expect(store.getSnapshot().data).toEqual({ a: 2 });
    });

    test('applies keyed patches keeping untouched rows identical', () => {
        const { client, socket } = build();
        const store = client.store<{ id: number; n: string }[]>('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', key: 'id', data: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }] });

        const before = store.getSnapshot().data!;
        socket.deliver({
            t: 'patch', sid, from: 1, to: 2, hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, n: 'bb' } }]
        });

        expect(store.getSnapshot().data![0]).toBe(before[0]);
        expect(store.getSnapshot().data![1]).toEqual({ id: 2, n: 'bb' });
    });

    test('asks for a resync when the patch revision does not follow', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', data: { a: 1 } });

        socket.deliver({ t: 'patch', sid, from: 5, to: 6, hash: 'h9', ops: [] });

        expect(socket.sent.some(m => m.t === 'resync' && m.sid === sid)).toBe(true);
    });

    test('marks the store stale without dropping the data', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', data: { a: 1 } });
        socket.deliver({ t: 'stale', sid, reason: 'db down' });

        expect(store.getSnapshot()).toMatchObject({ stale: true });
        expect(store.getSnapshot().data).toEqual({ a: 1 });
    });

    test('surfaces a server error on the store', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        socket.deliver({ t: 'error', sid: socket.subs()[0].sid, code: 'unknown_resource', message: 'nope' });

        expect(store.getSnapshot()).toMatchObject({ pending: false, error: 'nope' });
    });

    test('two stores with the same resource and inputs share one subscription', () => {
        const { client, socket } = build();
        const a = client.store('r', { params: {}, query: { x: '1' } });
        const b = client.store('r', { params: {}, query: { x: '1' } });
        a.subscribe(() => {});
        b.subscribe(() => {});
        socket.open();

        expect(a).toBe(b);
        expect(socket.subs()).toHaveLength(1);
    });

    test('unsubscribing the last listener sends unsub after the grace period', async () => {
        const { client, socket } = build({ unsubGraceMs: 10 });
        const store = client.store('r', { params: {}, query: {} });
        const off = store.subscribe(() => {});
        socket.open();
        off();

        expect(socket.sent.some(m => m.t === 'unsub')).toBe(false);
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(socket.sent.some(m => m.t === 'unsub')).toBe(true);
    });

    test('hydration seeds the store and subscribes with the hash it already has', () => {
        const hydrate = { 'r|{"params":{},"query":{}}': { data: { a: 1 }, hash: 'h1' } };
        const { client, socket } = build({ hydrate });
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        expect(store.getSnapshot()).toMatchObject({ pending: false });
        expect(store.getSnapshot().data).toEqual({ a: 1 });
        expect(socket.subs()[0].hash).toBe('h1');
    });

    test('a current response leaves the hydrated data untouched', () => {
        const hydrate = { 'r|{"params":{},"query":{}}': { data: { a: 1 }, hash: 'h1' } };
        const { client, socket } = build({ hydrate });
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const before = store.getSnapshot();

        socket.deliver({ t: 'current', sid: socket.subs()[0].sid, rev: 1, hash: 'h1' });

        expect(store.getSnapshot().data).toBe(before.data);
    });

    test('resubscribes every live store on reconnect, carrying the hash', () => {
        const sockets: FakeSocket[] = [];
        const client = new LiveClient({
            url: 'ws://test/live',
            unsubGraceMs: 5,
            reconnect: { initialMs: 1, maxMs: 2 },
            socketFactory: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            }
        });

        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        sockets[0].open();
        socketDeliverSnapshot(sockets[0]);

        sockets[0].onclose?.();

        return new Promise<void>(resolve => {
            setTimeout(() => {
                expect(sockets.length).toBeGreaterThan(1);
                sockets[1].open();
                expect(sockets[1].subs()[0].hash).toBe('h1');
                client.close();
                resolve();
            }, 40);
        });
    });
});

function socketDeliverSnapshot(socket: FakeSocket): void {
    socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: { a: 1 } });
}
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/client-core.test.ts`
Expected: FAIL — `Cannot find module '../src/client/core'`

- [ ] **Step 3: Implementar o núcleo do cliente**

`packages/live/src/client/core.ts`:

```ts
import { PatchEngine } from '../patch/PatchEngine';
import { canonical } from '../shared/canonical';
import type { LiveInputs } from '../shared/inputs';
import {
    LIVE_PROTOCOL_VERSION,
    type ClientMessage,
    type ServerMessage
} from '../shared/protocol';

export interface LiveState<T> {
    data: T | undefined;
    pending: boolean;
    error: string | null;
    /** The server cannot vouch for this being current. Data still shown. */
    stale: boolean;
}

export interface LiveStore<T> {
    subscribe(listener: () => void): () => void;
    getSnapshot(): LiveState<T>;
}

/** The slice of WebSocket this client uses, and the seam tests inject through. */
export interface LiveSocket {
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onclose: (() => void) | null;
    onerror: ((error: unknown) => void) | null;
}

export interface LiveClientOptions {
    url: string;
    token?: string;
    /**
     * Server-rendered payloads, keyed by `${resource}|${canonical(inputs)}`.
     * Lets the first paint skip the waterfall: the store starts full and the
     * subscription only says "this is the hash I already have".
     */
    hydrate?: Record<string, { data: unknown; hash: string }>;
    unsubGraceMs?: number;
    reconnect?: { initialMs?: number; maxMs?: number };
    socketFactory?: (url: string) => LiveSocket;
}

interface Entry {
    sid: string;
    key: string;
    resource: string;
    inputs: LiveInputs;
    refs: number;
    revision: number;
    hash: string | null;
    patcher: PatchEngine;
    state: LiveState<unknown>;
    listeners: Set<() => void>;
    dropTimer: ReturnType<typeof setTimeout> | null;
    store: LiveStore<unknown>;
}

const DEFAULT_UNSUB_GRACE_MS = 5000;
const DEFAULT_INITIAL_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30000;

export class LiveClient {
    private readonly entries = new Map<string, Entry>();
    private readonly bySid = new Map<string, Entry>();
    private socket: LiveSocket | null = null;
    private connected = false;
    private closed = false;
    private attempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private nextSid = 0;

    constructor(private readonly options: LiveClientOptions) {}

    store<T>(resource: string, inputs: LiveInputs): LiveStore<T> {
        const key = storeKey(resource, inputs);
        const existing = this.entries.get(key);

        if (existing) {
            return existing.store as LiveStore<T>;
        }

        const hydrated = this.options.hydrate?.[key];
        const entry: Entry = {
            sid: `s${this.nextSid++}`,
            key,
            resource,
            inputs,
            refs: 0,
            revision: hydrated ? 1 : 0,
            hash: hydrated?.hash ?? null,
            patcher: new PatchEngine(),
            state: {
                data: hydrated?.data,
                pending: hydrated === undefined,
                error: null,
                stale: false
            },
            listeners: new Set(),
            dropTimer: null,
            store: undefined as unknown as LiveStore<unknown>
        };

        entry.store = {
            subscribe: (listener: () => void) => this.retain(entry, listener),
            getSnapshot: () => entry.state
        };

        this.entries.set(key, entry);
        this.bySid.set(entry.sid, entry);

        return entry.store as LiveStore<T>;
    }

    close(): void {
        this.closed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.socket?.close();
        this.socket = null;
        this.connected = false;
    }

    // ------------------------------------------------------------ lifecycle

    private retain(entry: Entry, listener: () => void): () => void {
        entry.listeners.add(listener);
        entry.refs += 1;

        if (entry.dropTimer) {
            clearTimeout(entry.dropTimer);
            entry.dropTimer = null;
        }

        if (entry.refs === 1) {
            this.ensureConnected();
            this.sendSub(entry);
        }

        return () => {
            entry.listeners.delete(listener);
            entry.refs -= 1;

            if (entry.refs > 0 || entry.dropTimer) {
                return;
            }

            // Grace period: coming back from a navigation must not tear the
            // subscription down and build it again.
            entry.dropTimer = setTimeout(() => {
                entry.dropTimer = null;

                if (entry.refs > 0) {
                    return;
                }

                this.send({ t: 'unsub', sid: entry.sid });
                this.entries.delete(entry.key);
                this.bySid.delete(entry.sid);
            }, this.options.unsubGraceMs ?? DEFAULT_UNSUB_GRACE_MS);
        };
    }

    private ensureConnected(): void {
        if (this.socket || this.closed) {
            return;
        }

        const factory = this.options.socketFactory ?? defaultSocketFactory;
        const socket = factory(this.options.url);
        this.socket = socket;

        socket.onopen = () => {
            this.connected = true;
            this.attempt = 0;
            this.send({ t: 'hello', v: LIVE_PROTOCOL_VERSION, token: this.options.token });

            // Reconnect is just "subscribe again, carrying the hash of what is
            // on screen". There is no session to restore, because there is no
            // session.
            for (const entry of this.entries.values()) {
                if (entry.refs > 0) {
                    this.sendSub(entry);
                }
            }
        };

        socket.onmessage = event => this.onMessage(event.data);
        socket.onclose = () => this.onDisconnect();
        socket.onerror = () => this.onDisconnect();
    }

    private onDisconnect(): void {
        this.connected = false;
        this.socket = null;

        if (this.closed || this.reconnectTimer) {
            return;
        }

        const initial = this.options.reconnect?.initialMs ?? DEFAULT_INITIAL_BACKOFF_MS;
        const max = this.options.reconnect?.maxMs ?? DEFAULT_MAX_BACKOFF_MS;
        const ceiling = Math.min(max, initial * 2 ** this.attempt);

        // Full jitter, and it is mandatory: a deploy reconnects every client at
        // once, and a synchronised recompute storm takes the database down.
        const delay = Math.random() * ceiling;
        this.attempt += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnected();
        }, delay);
    }

    private sendSub(entry: Entry): void {
        this.send({
            t: 'sub',
            sid: entry.sid,
            resource: entry.resource,
            inputs: entry.inputs,
            hash: entry.hash ?? undefined
        });
    }

    private send(message: ClientMessage): void {
        if (!this.socket || !this.connected) {
            return;
        }

        this.socket.send(JSON.stringify(message));
    }

    // -------------------------------------------------------------- inbound

    private onMessage(raw: string): void {
        let message: ServerMessage;

        try {
            message = JSON.parse(raw) as ServerMessage;
        } catch {
            return;
        }

        const entry = this.bySid.get((message as { sid?: string }).sid ?? '');

        if (!entry) {
            return;
        }

        switch (message.t) {
            case 'snapshot':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                this.update(entry, { data: message.data, pending: false, error: null, stale: false });
                return;

            case 'current':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                // Content already on screen: touch only the flags, keep `data`
                // referentially identical so nothing re-renders.
                this.update(entry, { data: entry.state.data, pending: false, error: null, stale: false });
                return;

            case 'patch':
                if (message.from !== entry.revision) {
                    // A hole in the sequence. Ask for full state rather than
                    // applying ops to a base we cannot vouch for.
                    this.send({ t: 'resync', sid: entry.sid, hash: entry.hash ?? undefined });
                    return;
                }

                entry.revision = message.to;
                entry.hash = message.hash;
                this.update(entry, {
                    data: entry.patcher.apply(entry.state.data, message.ops),
                    pending: false,
                    error: null,
                    stale: false
                });
                return;

            case 'stale':
                this.update(entry, { ...entry.state, stale: true });
                return;

            case 'error':
                this.update(entry, { ...entry.state, pending: false, error: message.message });
                return;
        }
    }

    private update(entry: Entry, next: LiveState<unknown>): void {
        if (
            next.data === entry.state.data &&
            next.pending === entry.state.pending &&
            next.error === entry.state.error &&
            next.stale === entry.state.stale
        ) {
            // Nothing changed. Keeping the same object is what makes
            // useSyncExternalStore stable instead of looping.
            return;
        }

        entry.state = next;

        for (const listener of entry.listeners) {
            listener();
        }
    }
}

export function storeKey(resource: string, inputs: LiveInputs): string {
    return `${resource}|${canonical({ params: inputs.params ?? {}, query: inputs.query ?? {} })}`;
}

function defaultSocketFactory(url: string): LiveSocket {
    return new WebSocket(url) as unknown as LiveSocket;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bun test packages/live/test/client-core.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add the framework-agnostic client core

One hash serves three problems: first paint without a waterfall, reconnect
without retransmitting what the screen already holds, and conditional
polling when WebSocket is blocked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Adapter React

Poucas linhas por cima do núcleo — se crescer, é lógica vazando. O componente
continua dono do estado local (`useState` de item selecionado, foco, modal); o
estado do servidor entra como mais uma store ao lado dele.

**Files:**
- Create: `packages/live/src/client/react.ts`
- Modify: `packages/live/package.json` — `react`/`react-dom` como devDependencies
- Test: `packages/live/test/react-adapter.test.tsx`

**Interfaces:**
- Consumes: `LiveClient`, `LiveStore`, `LiveState` (Task 12).
- Produces:
  - `const LiveContext: React.Context<LiveClient | null>`
  - `function LiveProvider(props: { client: LiveClient; children?: React.ReactNode }): React.ReactElement`
  - `function useLive<T>(resource: string, inputs?: Partial<LiveInputs>): LiveState<T>`

- [ ] **Step 1: Adicionar React como devDependency**

Em `packages/live/package.json`, acrescentar antes de `"keywords"`:

```json
  "devDependencies": {
    "@types/react": "^18.3.12",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
```

Run: `bun install`

- [ ] **Step 2: Escrever o teste que falha**

Criar `packages/live/test/react-adapter.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';

function silentSocket(): LiveSocket {
    return {
        send() {},
        close() {},
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null
    };
}

function clientWith(hydrate: Record<string, { data: unknown; hash: string }>): LiveClient {
    return new LiveClient({ url: 'ws://test/live', hydrate, socketFactory: silentSocket });
}

describe('useLive', () => {
    test('renders hydrated server state on the first pass, with no round trip', () => {
        const client = clientWith({
            'UsersController.list|{"params":{},"query":{"status":"active"}}': {
                data: [{ id: 1, name: 'Ada' }],
                hash: 'h1'
            }
        });

        function UserList() {
            const { data, stale } = useLive<{ id: number; name: string }[]>(
                'UsersController.list',
                { query: { status: 'active' } }
            );

            return createElement(
                'ul',
                { 'data-stale': String(stale) },
                (data ?? []).map(user => createElement('li', { key: user.id }, user.name))
            );
        }

        const html = renderToString(
            createElement(LiveProvider, { client }, createElement(UserList))
        );

        expect(html).toContain('Ada');
        expect(html).toContain('data-stale="false"');
    });

    test('renders the pending state when nothing was hydrated', () => {
        const client = clientWith({});

        function Pending() {
            const { pending } = useLive('UsersController.list');
            return createElement('span', null, pending ? 'loading' : 'ready');
        }

        const html = renderToString(createElement(LiveProvider, { client }, createElement(Pending)));

        expect(html).toContain('loading');
    });

    test('the same resource and inputs resolve to the same store instance', () => {
        const client = clientWith({});
        const a = client.store('r', { params: {}, query: { x: '1' } });
        const b = client.store('r', { params: {}, query: { x: '1' } });
        const c = client.store('r', { params: {}, query: { x: '2' } });

        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    test('fails loudly outside a provider', () => {
        function Orphan() {
            useLive('r');
            return null;
        }

        expect(() => renderToString(createElement(Orphan))).toThrow(/LiveProvider/);
    });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `bun test packages/live/test/react-adapter.test.tsx`
Expected: FAIL — `Cannot find module '../src/client/react'`

- [ ] **Step 4: Implementar o adapter**

`packages/live/src/client/react.ts`:

```ts
import {
    createContext,
    createElement,
    useContext,
    useMemo,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode
} from 'react';
import { canonical } from '../shared/canonical';
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState } from './core';

export const LiveContext = createContext<LiveClient | null>(null);

export function LiveProvider(props: { client: LiveClient; children?: ReactNode }): ReactElement {
    return createElement(LiveContext.Provider, { value: props.client }, props.children);
}

/**
 * Subscribe a component to server-owned state.
 *
 * The component keeps its own local state next to this — selected row, open
 * modal, focused input. None of that travels; only the server's data does.
 */
export function useLive<T>(resource: string, inputs: Partial<LiveInputs> = {}): LiveState<T> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLive() requires a <LiveProvider client={...}> above it in the tree.');
    }

    const params = inputs.params ?? {};
    const query = inputs.query ?? {};
    const identity = canonical({ params, query });

    // Depend on the canonical form, not on the object: a new literal every
    // render would resubscribe on every render.
    const normalized = useMemo(() => ({ params, query }), [identity]);
    const store = useMemo(() => client.store<T>(resource, normalized), [client, resource, normalized]);

    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `bun test packages/live/test/react-adapter.test.tsx`
Expected: PASS — 4 tests.

Se o Bun não resolver `react-dom/server`, confirmar que o `bun install` do Step 1
rodou na raiz do monorepo, e não dentro de `packages/live`.

- [ ] **Step 6: Commit**

```bash
git add packages/live
git commit -m "$(cat <<'EOF'
feat(live): add the React adapter

useLive is a thin wrapper over useSyncExternalStore: the component keeps its
own local state next to it, and only the server's data crosses the wire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Aceite ponta a ponta e documentação

Prova os critérios da §12 que a Fase 1 promete, com um app Carno de verdade,
banco de verdade e WebSocket de verdade.

Cobertura honesta:

| Critério | Como é coberto aqui |
| :--- | :--- |
| 1 — write no ORM chega no cliente sem código de broadcast | **Direto**, com banco e WebSocket reais |
| 3 — reconexão não retransmite o que o cliente já tem | **Direto**, via handshake por hash. Matar o nó e outro assumir é Fase 2, quando existir bus distribuído |
| 4 — inserir no topo não perde foco | **Por procuração**: assere que o patch é `upsert` + `order`, não um `set` do array. Foco é propriedade de DOM e fica no exemplo, não em teste unitário |
| 5 — escrita em coluna não lida não gera patch | **Direto** |
| 6 — a mesma rota responde JSON a um `curl` | **Direto** |
| 8 — tenants diferentes nunca veem o dado um do outro | **Direto** |
| 2, 7 | Fora da Fase 1 (Postgres emitter, ilhas em views) |

**Files:**
- Test: `packages/live/test/acceptance.test.ts`
- Create: `docs/carno/docs/live/overview.md`
- Modify: `docs/carno/sidebars.ts`
- Modify: `README.md` — linha do pacote na tabela

**Interfaces:**
- Consumes: tudo.
- Produces: nada de código de produção.

- [ ] **Step 1: Escrever o teste de aceite**

Criar `packages/live/test/acceptance.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '@carno.js/orm';
import { withDatabase } from '@carno.js/orm/testing/with-database';
import { Controller, Get, Query } from '@carno.js/core';
import { createTestHarness } from '@carno.js/core/testing/TestHarness';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { resetLiveRuntime } from '../src/runtime';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live_tasks (id SERIAL PRIMARY KEY, title TEXT NOT NULL, tenant TEXT NOT NULL, touched_at TIMESTAMP NULL);'
];

@Entity({ tableName: 'live_tasks' })
class Task extends BaseEntity<Task> {
    @PrimaryKey()
    id!: number;

    @Property()
    title!: string;

    @Property()
    tenant!: string;

    @Property({ nullable: true })
    touchedAt?: Date;
}

@Controller('/tasks')
class TasksController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list(@Query('tenant') tenant: string) {
        const tasks = await Task.find({ tenant });
        return tasks.map(task => ({ id: task.id, title: task.title }));
    }
}

/** Minimal protocol client over a real WebSocket. */
class ProbeClient {
    private readonly socket: WebSocket;
    readonly received: ServerMessage[] = [];

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.onmessage = event => this.received.push(JSON.parse(String(event.data)));
    }

    static connect(port: number): Promise<ProbeClient> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/live`);
            socket.onopen = () => resolve(new ProbeClient(socket));
            socket.onerror = reject;
        });
    }

    send(message: unknown): void {
        this.socket.send(JSON.stringify(message));
    }

    close(): void {
        this.socket.close();
    }

    /** Wait for a message matching `predicate`, or fail after `timeoutMs`. */
    async wait(predicate: (message: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const found = this.received.find(predicate);

            if (found) {
                return found;
            }

            await new Promise(resolve => setTimeout(resolve, 10));
        }

        throw new Error(`Timed out. Received: ${JSON.stringify(this.received)}`);
    }
}

afterEach(() => {
    statementObserver.reset();
    resetLiveRuntime();
});

describe('Live Resources acceptance', () => {
    test('an ORM write reaches a subscriber with no broadcast code (criteria 1, 4, 5)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'first', tenant: 'acme' });

                const probe = await ProbeClient.connect(harness.port!);
                probe.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });

                const snapshot = await probe.wait(message => message.t === 'snapshot');
                expect((snapshot as any).data).toEqual([{ id: expect.any(Number), title: 'first' }]);

                // Criterion 1: nothing below mentions the socket.
                await Task.create({ title: 'second', tenant: 'acme' });

                const patch = await probe.wait(message => message.t === 'patch');

                // Criterion 4, by proxy: a keyed upsert, not a whole-array set.
                expect((patch as any).ops.every((op: any) => op.op === 'upsert' || op.op === 'order')).toBe(true);

                // Criterion 5: a write to a column the resource never selected.
                const before = probe.received.length;
                const [task] = await Task.find({ title: 'first' });
                await Task.update({ id: task.id }, { touchedAt: new Date() });
                await new Promise(resolve => setTimeout(resolve, 200));

                expect(probe.received.length).toBe(before);

                probe.close();
            } finally {
                await harness.close();
            }
        });
    });

    test('resubscribing with the current hash retransmits nothing (criterion 3)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'only', tenant: 'acme' });

                const first = await ProbeClient.connect(harness.port!);
                first.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });
                const snapshot = await first.wait(message => message.t === 'snapshot');
                first.close();

                const second = await ProbeClient.connect(harness.port!);
                second.send({
                    t: 'sub',
                    sid: 'a',
                    resource: 'TasksController.list',
                    inputs: { params: {}, query: { tenant: 'acme' } },
                    hash: (snapshot as any).hash
                });

                const current = await second.wait(message => message.t === 'current');
                expect((current as any).data).toBeUndefined();

                second.close();
            } finally {
                await harness.close();
            }
        });
    });

    test('the same route still answers plain JSON (criterion 6)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController] })],
                listen: true
            });

            try {
                await Task.create({ title: 'over http', tenant: 'acme' });

                const response = await harness.get('/tasks?tenant=acme');

                expect(response.status).toBe(200);
                expect(await response.json()).toEqual([{ id: expect.any(Number), title: 'over http' }]);
            } finally {
                await harness.close();
            }
        });
    });

    test('two tenants subscribing the same resource never share an instance (criterion 8)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'acme-only', tenant: 'acme' });
                await Task.create({ title: 'globex-only', tenant: 'globex' });

                const acme = await ProbeClient.connect(harness.port!);
                const globex = await ProbeClient.connect(harness.port!);

                acme.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });
                globex.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'globex' } } });

                const acmeSnapshot = await acme.wait(message => message.t === 'snapshot');
                const globexSnapshot = await globex.wait(message => message.t === 'snapshot');

                expect((acmeSnapshot as any).data).toEqual([{ id: expect.any(Number), title: 'acme-only' }]);
                expect((globexSnapshot as any).data).toEqual([{ id: expect.any(Number), title: 'globex-only' }]);

                acme.close();
                globex.close();
            } finally {
                await harness.close();
            }
        });
    });
});
```

- [ ] **Step 2: Rodar o aceite**

```bash
docker-compose up -d
bun test packages/live/test/acceptance.test.ts
docker-compose down
```

Expected: PASS — 4 tests.

Se `createTestHarness` não expuser `port` quando `listen: true`, ver
`packages/core/src/testing/TestHarness.ts` — o campo existe na interface
`TestHarness`. Se o import por `@carno.js/core/testing/TestHarness` não
resolver, usar `../../core/src/testing/TestHarness`.

- [ ] **Step 3: Rodar a suíte inteira**

```bash
docker-compose up -d
bun test
docker-compose down
```

Expected: nenhuma regressão em `core`, `orm`, `views`, `websocket`, `client`.

- [ ] **Step 4: Escrever a documentação**

Criar `docs/carno/docs/live/overview.md`, cobrindo, nesta ordem:

1. **O que é** — uma frase: um `@Get()` marcado com `@Live()` também é uma
   subscrição, e uma escrita no seu Postgres via ORM chega sozinha na tela.
2. **Instalação** — `bun install "@carno.js/live"`, e o registro:
   ```ts
   app.use(LivePlugin.create({ controllers: [TasksController] }));
   ```
   com a nota de que os seus `@Gateway` vão em `gateways: [...]`, porque o core
   guarda um único handler de WebSocket.
3. **Declarar um resource** — o exemplo de `TasksController` do teste de aceite.
4. **Consumir no React** — `LiveProvider` + `useLive`, mostrando o estado local
   (`useState`) convivendo com o estado do servidor.
5. **`key` e por que ela importa** — sem chave, inserir no topo remonta a lista.
6. **Escopo** — a tabela dos três modos, com a frase: o default é privado, e
   compartilhar é otimização que se declara.
7. **O que invalida** — `AppEmitter` automático; `LiveService.invalidate()` para
   o resto; e o **furo do SQL cru**, com `dependsOn` como saída.
8. **Limites da Fase 1** — só `@Get()`; sem emissor Postgres; sem adapters
   Angular/Vue; sem ilhas em views; um processo só. Cada item apontando para a
   fase que o entrega.
9. **Configuração** — a tabela da §10.1 com os defaults.

- [ ] **Step 5: Registrar a documentação no sidebar e no README**

Em `docs/carno/sidebars.ts`, acrescentar após a categoria `WebSocket`:

```ts
    {
      type: 'category',
      label: 'Live',
      items: ['live/overview'],
    },
```

Em `README.md`, na tabela de pacotes, após a linha de `@carno.js/websocket`:

```md
| `@carno.js/live` | Server-owned reactive state: live resources, dependency-graph invalidation, and framework-native client stores. |
```

E na lista de links da seção Documentation, após a linha do WebSocket:

```md
- [Live](https://carnojs.github.io/carno.js/docs/live/overview)
```

- [ ] **Step 6: Commit**

```bash
git add packages/live docs README.md
git commit -m "$(cat <<'EOF'
test(live): prove phase 1 acceptance criteria end to end

Criteria 1, 3, 5, 6 and 8 are covered directly against a real database and a
real WebSocket. Criterion 4 is covered by proxy — the patch is a keyed upsert
rather than a whole-array set — because focus is a DOM property.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Cobertura da spec

Rastreamento de cada seção da spec contra as tasks, para o revisor poder achar
buracos.

| Seção da spec | Onde | Observação |
| :--- | :--- | :--- |
| §4.1 `DepKey` | Task 2 | Hierarquia de dois níveis, só `#` |
| §4.1 Instância / escopo | Task 6 | Escopo literal, não hasheado (desvio 1) |
| §4.2 Grafo | Tasks 3, 4 | As duas estruturas, puras |
| §4.3 Ancestral, colunas, joins, cardinalidade | Tasks 2, 3 | |
| §4.3 Furo do SQL cru | Task 2 (`dependsOn`), Task 7 (semeadura) | Falha ruidosa em dev fica para a Fase 2 |
| §4.4 `AppEmitter` | Task 9 | |
| §4.4 `PgNotifyEmitter` | — | Fase 2 |
| §4.4 `InvalidationBus` | Task 9 | Só `InProcess` |
| §4.5 Protocolo | Tasks 10, 11, 12 | As 5 mensagens de servidor e as 4 de cliente |
| §4.5 Recompute ≠ patch, coalescing, backpressure | Task 10 | Backpressure aproximado (desvio) |
| §4.6 Patches com chave, sharing estrutural | Task 5 | |
| §5.1 `@Live()` em rota existente | Tasks 6, 14 | |
| §5.2 Verbos | Task 7 | Fase 1 aceita só `@Get()` |
| §5.3 Inputs autorizados, não assinados | Task 6 | Identidade vem do escopo, nunca dos inputs |
| §5.4 Autorização contínua | — | Fase 2 (desvio 4) |
| §5.5 `LiveService.invalidate()` | Task 11 | |
| §5.6 Validações de startup | Task 7 | Mais `@Header()`/`@Locals()` (desvio 3) |
| §6.1 Núcleo agnóstico | Task 12 | |
| §6.2 Adapter React | Task 13 | Angular/Vue/vanilla: Fase 3 |
| §6.3 Otimismo | — | Fase 2 |
| §6.4 Ciclo de vida / refcount | Tasks 10, 12 | Nos dois lados |
| §7 Tipagem ponta a ponta | — | Fase 2 (codegen do `@carno.js/client`). Fase 1 usa o id do resource como string |
| §7 Hash de input compartilhado | Tasks 1, 6 | `shared/` importado pelos dois lados |
| §8.1 Handshake por hash | Tasks 10, 12 | |
| §8.2 Reconexão e backoff com jitter | Task 12 | |
| §8.3 MVC e ilhas | — | Fase 3 |
| §8.4 Degradação SSE/polling | — | Fase 3 |
| §9 Pacotes e fronteiras | Todas | |
| §10 Guardas | Tasks 10, 12 | |
| §10.1 Parâmetros | Task 2 | Tabela completa em `config.ts` |
| §10 Métricas / `ObservabilityService` | Task 10 parcial | `stats()` existe; a ligação com `ObservabilityService` é Fase 3 |
| §12 Critérios de aceite | Task 14 | 1, 3, 4, 5, 6, 8 |

## Riscos deste plano

1. **A regex de `extractRowIds` é escrita contra um `where` que eu não vi
   gerado.** O Step 7 da Task 9 é o que resolve isso, e diz explicitamente o que
   fazer se o formato real não casar. Se o `SqlConditionBuilder` produzir algo
   que não dá para provar como igualdade de chave primária, toda invalidação
   degrada para a chave de tabela: continua correto, fica mais caro, e a métrica
   de recompute-sem-patch vai denunciar.
2. **O hook no `SqlBuilder` toca o caminho quente de toda query.** São três
   comparações com `null` por query quando o pacote não está instalado. Se
   aparecer regressão de performance na suíte do ORM, é aqui.
3. **`websocket._wsHandlerBuilder` é acesso a campo com prefixo `_`.** Funciona,
   mas é acoplamento a um detalhe do core. A saída limpa é o core aceitar vários
   builders, e isso é trabalho separado.
4. **Testes com temporizador são flaky por natureza.** As janelas nos testes
   (`coalesceMs: 1`, `unsubGraceMs: 5`, esperas de 25ms) têm folga, mas em CI
   carregado podem falhar. Se acontecer, aumentar a espera, nunca diminuir a
   janela.
5. **`fnv1a64` são duas pistas de FNV-1a correlacionadas, não um hash de 64 bits
   de verdade.** É melhor que 32 bits e vive num módulo só. Se a taxa de
   colisão virar preocupação real, trocar por xxhash ou SHA-256 truncado é uma
   mudança de um arquivo.
