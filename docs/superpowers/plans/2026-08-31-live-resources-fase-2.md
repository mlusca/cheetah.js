# Live Resources — Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o Live Resources de "funciona num processo, para escritas feitas pelo ORM" para "funciona num cluster, para escritas feitas por qualquer um, com tipos ponta a ponta e otimismo no cliente".

**Architecture:** Quatro frentes sobre o núcleo da Fase 1. (1) Alcance: um `PgListener` sobre `LISTEN/NOTIFY`, um `PgNotifyEmitter` que instala triggers e traduz o payload para o mesmo vocabulário de chave do `AppEmitter`, e um `PgNotifyBus` que leva invalidação de um nó para os outros. (2) Verbo: `@Live()` em `@Post()`, com `@Body()` virando input de primeira classe da identidade da instância. (3) Autorização: um `LiveAuthorizer` plugável, reavaliado por assinante e não por instância. (4) Tipos: o scanner do `@carno.js/client` passa a ler `@Live()`, o codegen emite descriptors tipados, e o cliente ganha `useLive(descriptor)` e otimismo numa camada por cima do snapshot confirmado.

**Tech Stack:** Bun 1.4 (`sql.listen` / `sql.notify`), TypeScript 5.9, decorators legacy, `reflect-metadata`, `bun:test`, PostgreSQL 11+ (`CREATE TRIGGER ... EXECUTE FUNCTION`), `@carno.js/core`, `@carno.js/orm`, `@carno.js/websocket`, `@carno.js/client`, React 18.

**Spec:** [`docs/superpowers/specs/2026-08-31-live-resources-design.md`](../specs/2026-08-31-live-resources-design.md) — este plano implementa a **Fase 2** da §13, mais a §5.4, que a Fase 1 adiou explicitamente. Leia a spec antes de começar; o plano argumenta a partir dela.

**Plano anterior:** [`2026-08-31-live-resources-fase-1.md`](./2026-08-31-live-resources-fase-1.md). A Fase 1 está implementada e commitada (`636d2b8`..`7b6d624`). Este plano assume esse código como base e cita os arquivos dele pelo caminho real.

## Global Constraints

- **Runtime:** Bun 1.4.0 ou superior. `sql.listen`/`sql.notify` existem no runtime a partir dessa versão — a documentação oficial ainda diz que não. A Task 4, Step 1 prova isso contra um banco real antes de qualquer coisa ser construída em cima.
- **Banco:** PostgreSQL 11 ou superior para o `PgNotifyEmitter` (`CREATE TRIGGER ... EXECUTE FUNCTION` só existe do 11 em diante). O `docker-compose.yml` da raiz sobe `postgres:15.1` na porta **5433**. Nada nesta fase pode quebrar quem roda MySQL: o emissor Postgres é opt-in e o resto do live não sabe que ele existe.
- **TypeScript:** herda `tsconfig.json` da raiz — `module: CommonJS`, `target: ES2021`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strictPropertyInitialization: false`.
- **Indentação:** 4 espaços em `packages/live`, `packages/core` e `packages/client`; **2 espaços** em `packages/orm`. Aspas simples, ponto e vírgula, em todos.
- **Testes:** `bun test`. Import de `bun:test`. Arquivos novos do live em `packages/live/test/**/*.test.ts`; do client em `packages/client/test/**/*.spec.ts` — é o sufixo que aquele pacote usa.
- **Dependências:** zero dependências de runtime novas.
- **Código e comentários em inglês.** A documentação do Docusaurus (`docs/carno/docs/**`) também é **em inglês**, seguindo `docs/carno/docs/live/overview.md`, que já está assim. Só os documentos de `docs/superpowers/**` são em português.
- **Defaults da §10.1, inalterados:** `coalesceMs: 16`, `maxKeysPerRead: 64`, `maxInputBytes: 8192`, `unsubGraceMs: 5000`, `maxPendingPatches: 32`, `fanoutQueueThreshold: 500`, `maxInstancesPerConnection: 64`, `maxInstancesPerNode: 50000`.
- **Defaults novos desta fase:** `pgChannel: 'carno_live'`, `pgBusChannel: 'carno_live_bus'`, `pgHeartbeatMs: 5000`, `pgRetryMs: 1000`, `pgMaxPayloadBytes: 7000`.
- **Branch:** criar `feat/live-resources-fase-2` a partir de `docs/live-resources-design` antes da Task 1.
- **Commits:** toda mensagem termina com o trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Pré-requisito: o banco precisa estar de pé

Nove testes da Fase 1 falham hoje por `ERR_POSTGRES_CONNECTION_REFUSED`. Eles não estão quebrados, estão sem banco. Antes da Task 1:

```bash
docker compose up -d db
```

E confirme que a suíte da Fase 1 passa inteira:

```bash
bun test packages/live
```

Esperado: **141 pass, 0 fail**. Se algo falhar por outro motivo que não conexão, pare e conserte antes de começar — a Fase 2 mexe no `LiveEngine`, no `AppEmitter` e no `ResourceRegistry`, e você não quer descobrir uma regressão da Fase 1 no meio disso.

## Desvios deliberados da spec

Cinco pontos onde a implementação se afasta do texto. Cada um é uma decisão, não um esquecimento, e está aqui para o revisor poder discordar.

**1. Autorização é por assinante, não por instância.** A §5.4 diz "a instância depende de `auth:user#42`". Isso fecha para `shared: 'private'`, onde instância e assinante são a mesma coisa. Para `shared: 'tenant'` e `'public'`, uma instância é compartilhada por várias conexões, e derrubá-la porque **um** assinante perdeu permissão tiraria o dado de todo mundo. A implementação mantém a ideia — a chave `auth:` é uma dependência como outra, e invalidá-la força reavaliação — mas guarda e reavalia a decisão por par `(conexão, instância)`. Quem perde permissão recebe `error` e é desligado; os outros seguem recebendo patch.

Segundo detalhe, no mesmo lugar: a §5.4 diz "reavaliada a cada recompute". A decisão fica em cache e é reavaliada quando a chave `auth:` da conexão é invalidada. Reavaliar de fato a cada recompute colocaria uma consulta de autorização no caminho de **cada patch de cada conexão** — um `authorizer` que fala com o banco viraria uma tempestade sob carga, que é exatamente o cenário em que o sistema precisa se comportar bem. Invalidar a chave é o gatilho, e é barato e explícito.

**2. O bus distribuído desta fase é só o de Postgres.** A §4.4 lista `InProcess | Queue | Redis | PgNotify`. O banco já está lá, já é transacional, e já é o mesmo canal do `PgNotifyEmitter` — um segundo bus não prova nada que o primeiro não prove, e cada implementação a mais é superfície a mais para manter. `InvalidationBus` continua sendo a interface que reduz Redis ou fila a escrever uma classe; `Bun.RedisClient` já traz `subscribe`/`publish` embutidos, então quando alguém precisar, também será sem dependência nova.

**3. Descriptors são aditivos; não substituem o `client<App>()`.** A §7 mostra `api.users.list` servindo aos três usos. Entregamos o descriptor e o `createApi()` que o torna chamável, mas o proxy `client<App>(baseUrl)` existente continua funcionando, testado e inalterado. Trocar uma superfície de cliente que funciona por outra, no mesmo passo em que se introduz a segunda, transforma um bug de tipos num bug de HTTP.

Junto disso, o input do descriptor é `{ params, query, body }` e não o objeto plano que a §7 mostra em `api.users.list({ status: 'active' })`. Um objeto plano não consegue distinguir `/cards/:id` de `?id=` quando os dois nomes coincidem, e a forma estruturada é a mesma que o `LiveInputs` já usa nos dois lados do fio.

**4. `prefetch()` não entra.** É o terceiro uso da §7 e é SSR — ou seja, `@carno.js/views` e ilhas, que é Fase 3 (critério 7). Nada nesta fase depende dele.

**5. O overlay otimista some no settle da ação, como a spec manda — e isso tem uma janela.** A §6.3 diz que o overlay some "na confirmação ou no erro". Entre a resposta HTTP chegar e o patch do servidor chegar existe uma janela de milissegundos em que a UI volta ao confirmado antigo. Implementamos o que está escrito e registramos a janela nos riscos; fechá-la exige o servidor devolver a revisão que a ação produziu, o que é protocolo novo e não está na spec.

## Comportamentos que a spec não trata

- **Eco duplo é esperado, e é quase de graça.** Com o `PgNotifyEmitter` ligado, uma escrita do próprio app pelo ORM aciona o `AppEmitter` **e** o trigger. As duas invalidações têm a mesma chave, caem na mesma janela de `coalesceMs`, e o `pending` do engine é um `Set` de `instanceId` — a segunda é absorvida. Ainda assim o `AppEmitter` passa a pular as tabelas cobertas pelo emissor Postgres, porque recompute economizado é recompute economizado.
- **Notificação perdida é pior que notificação demais.** Se a conexão de `LISTEN` cair, tudo que foi escrito na janela some sem deixar rastro, e o sintoma é uma tela parada em dado velho, sem erro em lugar nenhum. Na reconexão o emissor invalida **a tabela inteira** de tudo que observa. É caro e é certo — a mesma regra da §4.3.
- **O trigger só notifica se algo mudou de fato.** Um `UPDATE` que grava o mesmo valor não gera notificação: o diff de colunas é feito dentro do trigger com `jsonb`, e diff vazio retorna sem `pg_notify`. Não é economia de tráfego, é a regra "recompute ≠ patch" descendo um nível.
- **SQL montado por concatenação é validado antes de existir.** Nome de tabela, de coluna e de canal vêm da configuração da aplicação e entram em `CREATE TRIGGER` por interpolação. Todos passam por `/^[A-Za-z_][A-Za-z0-9_]*$/` e são recusados fora disso.

## File Structure

**Arquivos novos em `packages/live/`:**

| Arquivo | Responsabilidade |
| :--- | :--- |
| `src/auth/authorizer.ts` | `LiveAuthorizer`, default permissivo, chaves `auth:` |
| `src/emitters/pg-trigger-sql.ts` | O SQL do trigger, isolado e testável sem banco |
| `src/emitters/pg-listener.ts` | Conexão dedicada de `LISTEN`, heartbeat e reconexão |
| `src/emitters/pg-notify-emitter.ts` | Instala trigger e traduz payload em `InvalidationEvent` |
| `src/bus/PgNotifyBus.ts` | Bus entre nós, com id de nó e supressão de eco |
| `src/shared/descriptor.ts` | `LiveDescriptor<R>`, gêmeo estrutural do que o codegen emite |
| `src/client/optimistic.ts` | Tipos do overlay otimista, compartilhados pelo core e pelo React |

**Arquivos modificados em `packages/live/`:**

| Arquivo | Mudança |
| :--- | :--- |
| `src/shared/inputs.ts` | `LiveInputs` ganha `body` |
| `src/resource/instance-id.ts` | `canonicalInputs` inclui o body |
| `src/resource/ResourceRegistry.ts` | `@Post()` permitido; `@Body()` vira argumento |
| `src/LiveEngine.ts` | Autorização por assinante, escopo por conexão, reautorização em `auth:` |
| `src/LivePlugin.ts` | Opções `authorizer`, `pgNotify`, `distributed` |
| `src/emitters/AppEmitter.ts` | Pula tabelas cobertas pelo emissor Postgres |
| `src/transport/LiveGateway.ts` | Entrega o escopo resolvido ao engine |
| `src/client/core.ts` | Body na chave de store, camada de overlay, patch aplicado no confirmado |
| `src/client/react.ts` | `useLive(descriptor)`, `useLiveAction` |
| `src/index.ts` | Exporta a superfície nova |

**Arquivos modificados em `packages/client/`:**

| Arquivo | Mudança |
| :--- | :--- |
| `src/codegen/types.ts` | `RouteSchema.live` |
| `src/codegen/scan.ts` | Lê `@Live()`; regras da §5.6 e da §4.6 viram `ScanWarning` |
| `src/codegen/emit.ts` | Emite o tipo `RouteDescriptor` e a const `routes` |
| `src/client/http.ts` | Extrai `executeRequest` para poder ser reusado |
| `src/client/descriptor.ts` | **novo** — `createApi()` |
| `src/client/types.ts` | Exporta `RouteResponse` e os tipos do descriptor |
| `test/fixtures/app/src/live.controller.ts` | **novo** — fixture com rotas `@Live()` |

**Documentação:**

| Arquivo | Mudança |
| :--- | :--- |
| `docs/carno/docs/live/scaling.md` | **novo** — emissor Postgres, bus, cluster |
| `docs/carno/docs/live/typed-client.md` | **novo** — descriptors, `useLive` tipado, otimismo |
| `docs/carno/docs/live/overview.md` | `@Post()`, autorização, links para as duas novas |
| `docs/carno/sidebars.ts` | As duas páginas novas |

---
### Task 1: O body faz parte da identidade da instância

Antes de `@Post()` existir como verbo assinável, o body precisa entrar na conta de "mesmo resource, mesmo escopo, mesmos inputs é uma instância só". Se ele não entrar, dois clientes com filtros diferentes compartilham instância e um deles vê o dado do outro — o mesmo erro que a Fase 1 evitou no escopo, um nível abaixo.

**Files:**
- Modify: `packages/live/src/shared/inputs.ts`
- Modify: `packages/live/src/resource/instance-id.ts`
- Modify: `packages/live/src/client/core.ts` (função `storeKey`, no fim do arquivo)
- Test: `packages/live/test/inputs-body.test.ts` (criar)

**Interfaces:**
- Consumes: `canonical()` de `src/shared/canonical.ts`; `fnv1a64()` de `src/shared/hash.ts`.
- Produces: `LiveInputs` com `body?: unknown`; `canonicalInputs(inputs, maxInputBytes)` passa a incluir o body na forma canônica. Todas as tasks seguintes assumem essa assinatura.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/inputs-body.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { canonicalInputs, instanceIdOf } from '../src/resource/instance-id';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';

const LIMIT = DEFAULT_LIVE_CONFIG.maxInputBytes;

describe('body as part of the instance identity', () => {
    test('the same body written in a different key order is the same input', () => {
        const first = canonicalInputs(
            { params: {}, query: {}, body: { status: 'active', page: 2 } },
            LIMIT
        );
        const second = canonicalInputs(
            { params: {}, query: {}, body: { page: 2, status: 'active' } },
            LIMIT
        );

        expect(first).toBe(second);
    });

    test('a different body is a different instance', () => {
        const active = instanceIdOf(
            'ReportsController.run',
            'pub',
            canonicalInputs({ params: {}, query: {}, body: { status: 'active' } }, LIMIT)
        );
        const archived = instanceIdOf(
            'ReportsController.run',
            'pub',
            canonicalInputs({ params: {}, query: {}, body: { status: 'archived' } }, LIMIT)
        );

        expect(active).not.toBe(archived);
    });

    test('an absent body and an empty body are the same instance', () => {
        const absent = canonicalInputs({ params: {}, query: {} }, LIMIT);
        const explicitNull = canonicalInputs({ params: {}, query: {}, body: null }, LIMIT);

        expect(absent).toBe(explicitNull);
    });

    test('an oversized body is refused before it becomes an instance', () => {
        expect(() =>
            canonicalInputs({ params: {}, query: {}, body: { blob: 'x'.repeat(LIMIT) } }, LIMIT)
        ).toThrow(/over the 8192 byte limit/);
    });

    test('a body that cannot be canonicalized is refused', () => {
        expect(() =>
            canonicalInputs({ params: {}, query: {}, body: { when: new Date() } }, LIMIT)
        ).toThrow(/not serializable/);
    });
});

describe('client store identity', () => {
    class FakeSocket implements LiveSocket {
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: ((error: unknown) => void) | null = null;
        send(): void {}
        close(): void {}
    }

    test('storeKey separates two bodies', () => {
        const one = storeKey('R.run', { params: {}, query: {}, body: { page: 1 } });
        const two = storeKey('R.run', { params: {}, query: {}, body: { page: 2 } });

        expect(one).not.toBe(two);
    });

    test('the same body reuses the same store', () => {
        const client = new LiveClient({ url: 'ws://test/live', socketFactory: () => new FakeSocket() });
        const first = client.store('R.run', { params: {}, query: {}, body: { page: 1 } });
        const second = client.store('R.run', { params: {}, query: {}, body: { page: 1 } });

        expect(first).toBe(second);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/inputs-body.test.ts`
Expected: FAIL. `canonicalInputs` hoje ignora o body, então "a different body is a different instance" e os dois testes de `storeKey` falham.

- [ ] **Step 3: Add `body` to `LiveInputs`**

Em `packages/live/src/shared/inputs.ts`, substitua a interface `LiveInputs`:

```ts
/** Everything a resource compute is allowed to read from the caller. */
export interface LiveInputs {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    /**
     * Body of a @Post() live resource. Absent on @Get().
     *
     * It is part of the instance identity, not extra baggage: two clients
     * posting different filters must not share one computed instance.
     */
    body?: unknown;
}
```

- [ ] **Step 4: Include the body in the canonical form**

Em `packages/live/src/resource/instance-id.ts`, substitua o corpo de `canonicalInputs`:

```ts
/** Canonical form of inputs, guarded by the size ceiling. */
export function canonicalInputs(inputs: LiveInputs, maxInputBytes: number): string {
    const encoded = canonical({
        params: inputs.params ?? {},
        query: inputs.query ?? {},
        // `canonical` renders undefined and null identically, so a GET (no
        // body) and a POST with an empty body land on the same string.
        body: inputs.body ?? null
    });
    const size = Buffer.byteLength(encoded, 'utf8');

    if (size > maxInputBytes) {
        throw new InputTooLargeError(size, maxInputBytes);
    }

    return encoded;
}
```

- [ ] **Step 5: Include the body in the client store key**

Em `packages/live/src/client/core.ts`, substitua a função `storeKey` no fim do arquivo:

```ts
export function storeKey(resource: string, inputs: LiveInputs): string {
    return `${resource}|${canonical({
        params: inputs.params ?? {},
        query: inputs.query ?? {},
        body: inputs.body ?? null
    })}`;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/live/test/inputs-body.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 7: Run the whole live suite for regressions**

Run: `bun test packages/live`
Expected: PASS. Os `instanceId` mudaram de valor (a forma canônica ganhou um campo), mas nenhum teste da Fase 1 depende do valor literal — eles comparam ids entre si.

- [ ] **Step 8: Commit**

```bash
git add packages/live/src/shared/inputs.ts packages/live/src/resource/instance-id.ts packages/live/src/client/core.ts packages/live/test/inputs-body.test.ts
git commit -m "feat(live): make the request body part of the instance identity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `@Live()` em `@Post()`

O critério real da §5.2 não é o verbo, é a idempotência. `POST` cobre a query cujos inputs não cabem numa query string, e nela `@Body()` é input de primeira classe. `PUT`, `PATCH` e `DELETE` continuam proibidos — não por impossibilidade, mas porque um `PUT` que só lê é abuso de protocolo.

**Files:**
- Modify: `packages/live/src/resource/ResourceRegistry.ts`
- Modify: `packages/live/src/transport/LiveGateway.ts` (o `case 'sub'`)
- Test: `packages/live/test/resource-registry.test.ts` (existente, editar)
- Test: `packages/live/test/live-post.test.ts` (criar)

**Interfaces:**
- Consumes: `LiveInputs.body` da Task 1.
- Produces: `ResourceRegistry` aceita `route.method === 'post'` e liga `@Body()` / `@Body('key')` ao argumento do handler. O `LiveGateway` repassa `message.inputs.body`.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/live-post.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Body, Controller, Get, Post, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { LiveValidationError, ResourceRegistry } from '../src/resource/ResourceRegistry';

interface ReportFilter {
    status: string;
    limit: number;
}

@Controller('/reports')
class ReportsController {
    @Post('/search')
    @Live({ key: 'id' })
    search(@Body() filter: ReportFilter) {
        return [{ id: 1, status: filter.status, limit: filter.limit }];
    }

    @Post('/by-status')
    @Live()
    byStatus(@Body('status') status: string) {
        return { status };
    }
}

@Controller('/bad-get-body')
class GetWithBodyController {
    @Get('/')
    @Live()
    read(@Body() filter: unknown) {
        return filter;
    }
}

describe('@Live() on @Post()', () => {
    test('registers a POST handler as a live resource', () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController());

        expect(registry.ids().sort()).toEqual([
            'ReportsController.byStatus',
            'ReportsController.search'
        ]);
    });

    test('binds the whole body to a bare @Body()', async () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController());

        const resource = registry.get('ReportsController.search')!;
        const { data } = await registry.compute(resource, {
            params: {},
            query: {},
            body: { status: 'open', limit: 10 }
        });

        expect(data).toEqual([{ id: 1, status: 'open', limit: 10 }]);
    });

    test('binds one field to @Body(key)', async () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController());

        const resource = registry.get('ReportsController.byStatus')!;
        const { data } = await registry.compute(resource, {
            params: {},
            query: {},
            body: { status: 'closed' }
        });

        expect(data).toEqual({ status: 'closed' });
    });

    test('refuses @Body() on a live @Get()', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(GetWithBodyController, new GetWithBodyController()))
            .toThrow(/carries no body/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/live-post.test.ts`
Expected: FAIL já no primeiro teste, com a mensagem da Fase 1: `@Post() for read-only queries arrives in phase 2`.

- [ ] **Step 3: Allow POST and bind the body**

Em `packages/live/src/resource/ResourceRegistry.ts`, faça quatro edições.

Primeira, a constante do topo:

```ts
/**
 * Verbs that may carry @Live. The real criterion is idempotence, not the verb:
 * subscribing means re-running the handler whenever the data changes, and
 * re-running a write duplicates the side effect. GET and POST are the two the
 * web uses for reading; a PUT that only reads is an abuse of the protocol and
 * is not worth the API surface.
 */
const ALLOWED_METHODS = new Set(['get', 'post']);
```

Segunda, a mensagem do verbo recusado:

```ts
            if (!ALLOWED_METHODS.has(route.method)) {
                throw new LiveValidationError(
                    `${where} is decorated with @Live() on @${route.method.toUpperCase()}(). ` +
                    `Subscribing means re-running the handler whenever the data changes, so it has ` +
                    `to be idempotent. Only @Get() and @Post() may be live.`
                );
            }
```

Terceira, substitua o bloco que recusava `@Body()` por um que só o recusa em `GET`:

```ts
            if (route.method === 'get' && params.some(param => param.type === 'body')) {
                throw new LiveValidationError(
                    `${where} uses @Body() on @Get(). A GET subscription carries no body; ` +
                    `declare the route as @Post() or read the value from @Query().`
                );
            }
```

Quarta, no `buildArgs` do fim do arquivo, acrescente o ramo do body:

```ts
    for (const param of params) {
        if (param.type === 'param') {
            args[param.index] = param.key ? inputs.params[param.key] : inputs.params;
        } else if (param.type === 'query') {
            args[param.index] = param.key ? inputs.query[param.key] : inputs.query;
        } else if (param.type === 'body') {
            args[param.index] = param.key
                ? (inputs.body as Record<string, unknown> | undefined)?.[param.key]
                : inputs.body;
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/live/test/live-post.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Carry the body through the gateway**

Em `packages/live/src/transport/LiveGateway.ts`, no `case 'sub'`, inclua o body ao montar os inputs:

```ts
        case 'sub': {
            const scope = runtime.scopes.get(connectionId) ?? { principal: connectionId };
            await runtime.engine.subscribe(
                connectionId,
                message.sid,
                message.resource,
                {
                    params: message.inputs?.params ?? {},
                    query: message.inputs?.query ?? {},
                    body: message.inputs?.body
                },
                scope,
                message.hash
            );
            return;
        }
```

- [ ] **Step 6: Update the Fase 1 test whose name is now wrong**

Em `packages/live/test/resource-registry.test.ts`, renomeie o teste do verbo — o `WritingController` usa `@Delete`, então ele continua passando, mas o nome mente:

```ts
    test('refuses @Live on a verb that is neither GET nor POST', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(WritingController, new WritingController()))
            .toThrow(LiveValidationError);
    });
```

- [ ] **Step 7: Run the whole live suite**

Run: `bun test packages/live`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/live/src/resource/ResourceRegistry.ts packages/live/src/transport/LiveGateway.ts packages/live/test/live-post.test.ts packages/live/test/resource-registry.test.ts
git commit -m "feat(live): allow @Live() on @Post() with the body as input

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Autorização que continua valendo depois do `sub` (§5.4)

A Fase 1 entregou isolação por escopo: ninguém vê a instância de outro tenant. O que faltou é o outro lado — o usuário que **tinha** permissão quando assinou e perdeu depois. Sem isto, uma subscrição é um token sem expiração.

O mecanismo da §5.4 é "o principal é uma dependência como outra": invalidar `auth:principal#42` força reavaliação. A diferença desta implementação está no desvio 1 — a decisão é guardada por par `(conexão, instância)`, porque uma instância `shared: 'tenant'` tem vários assinantes e derrubá-la inteira puniria quem não perdeu nada.

**Files:**
- Create: `packages/live/src/auth/authorizer.ts`
- Modify: `packages/live/src/LiveEngine.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/index.ts`
- Test: `packages/live/test/authorization.test.ts` (criar)

**Interfaces:**
- Consumes: `LiveScope`, `LiveInputs` (`src/shared/inputs.ts`); `ancestorsOf` (`src/graph/dep-key.ts`); `LiveMeta` (`src/metadata.ts`).
- Produces:
  - `interface LiveAuthorizer { authorize(request: LiveAuthorizationRequest): boolean | Promise<boolean> }`
  - `class AllowAllAuthorizer implements LiveAuthorizer`
  - `authKeysOf(scope: LiveScope): string[]`, `isAuthKey(key: string): boolean`
  - `new LiveEngine(resources, graph, subs, bus, transport, config, authorizer?)` — sétimo parâmetro **opcional**, para as chamadas da Fase 1 continuarem compilando.
  - `LivePlugin.create({ ..., authorizer })`.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/authorization.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Controller, Get } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { resolveLiveConfig } from '../src/config';
import { InProcessBus } from '../src/bus/InProcessBus';
import { DependencyGraph } from '../src/graph/DependencyGraph';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { dependencyContext } from '../src/resource/dependency-context';
import { LiveEngine, type LiveTransport } from '../src/LiveEngine';
import type { LiveAuthorizationRequest, LiveAuthorizer } from '../src/auth/authorizer';
import type { ServerMessage } from '../src/shared/protocol';

let counter = 0;

@Controller('/board')
class BoardController {
    @Get('/')
    @Live({ shared: 'public' })
    board() {
        dependencyContext.current()?.add({ key: 'orm:cards', columns: null });
        return { counter };
    }
}

class FakeTransport implements LiveTransport {
    readonly sent: { connectionId: string; message: ServerMessage }[] = [];

    send(connectionId: string, message: ServerMessage): number {
        this.sent.push({ connectionId, message });
        return 1;
    }

    messagesFor(connectionId: string): ServerMessage[] {
        return this.sent.filter(entry => entry.connectionId === connectionId).map(entry => entry.message);
    }

    clear(): void {
        this.sent.length = 0;
    }
}

/** Denies whichever principals are in `denied` at the moment it is asked. */
class RosterAuthorizer implements LiveAuthorizer {
    readonly denied = new Set<string>();
    calls = 0;

    authorize(request: LiveAuthorizationRequest): boolean {
        this.calls += 1;
        return !this.denied.has(String(request.scope.principal));
    }
}

class ThrowingAuthorizer implements LiveAuthorizer {
    authorize(): boolean {
        throw new Error('authorization backend is down');
    }
}

function build(authorizer: LiveAuthorizer) {
    const resources = new ResourceRegistry();
    resources.register(BoardController, new BoardController());

    const bus = new InProcessBus();
    const transport = new FakeTransport();
    const engine = new LiveEngine(
        resources,
        new DependencyGraph(),
        new SubscriptionRegistry(),
        bus,
        transport,
        resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 5 }),
        authorizer
    );
    engine.start();

    return { engine, transport };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

beforeEach(() => {
    counter = 0;
});

describe('authorization at subscribe time', () => {
    test('a denied principal gets an error and no data', async () => {
        const authorizer = new RosterAuthorizer();
        authorizer.denied.add('intruder');
        const { engine, transport } = build(authorizer);

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'intruder' });

        const messages = transport.messagesFor('c1');
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ t: 'error', code: 'forbidden' });
    });

    test('an authorizer that throws denies instead of leaking', async () => {
        const { engine, transport } = build(new ThrowingAuthorizer());

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'ada' });

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'error', code: 'forbidden' });
    });

    test('an allowed principal gets the snapshot', async () => {
        const { engine, transport } = build(new RosterAuthorizer());

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'ada' });

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'snapshot' });
    });
});

describe('authorization after the subscription', () => {
    test('revoking one principal does not disturb the others on a shared instance', async () => {
        const authorizer = new RosterAuthorizer();
        const { engine, transport } = build(authorizer);

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'ada' });
        await engine.subscribe('c2', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'linus' });
        transport.clear();

        authorizer.denied.add('ada');
        engine.invalidate('auth:principal#ada');
        await settle();

        expect(transport.messagesFor('c1')).toEqual([
            expect.objectContaining({ t: 'error', code: 'forbidden' })
        ]);
        expect(transport.messagesFor('c2')).toEqual([]);

        transport.clear();
        counter = 1;
        engine.invalidate('orm:cards');
        await settle();

        // The revoked connection is gone; the other one keeps its patches.
        expect(transport.messagesFor('c1')).toEqual([]);
        expect(transport.messagesFor('c2')[0]).toMatchObject({ t: 'patch' });
    });

    test('a broad auth key revokes every principal under it', async () => {
        const authorizer = new RosterAuthorizer();
        const { engine, transport } = build(authorizer);

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'ada' });
        await engine.subscribe('c2', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'linus' });
        transport.clear();

        authorizer.denied.add('ada');
        authorizer.denied.add('linus');
        engine.invalidate('auth:principal');
        await settle();

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'error', code: 'forbidden' });
        expect(transport.messagesFor('c2')[0]).toMatchObject({ t: 'error', code: 'forbidden' });
    });

    test('the decision is cached, so a patch does not re-ask the authorizer', async () => {
        const authorizer = new RosterAuthorizer();
        const { engine } = build(authorizer);

        await engine.subscribe('c1', 's1', 'BoardController.board', { params: {}, query: {} }, { principal: 'ada' });
        const afterSubscribe = authorizer.calls;

        counter = 1;
        engine.invalidate('orm:cards');
        await settle();

        expect(authorizer.calls).toBe(afterSubscribe);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/authorization.test.ts`
Expected: FAIL na resolução do módulo — `Cannot find module '../src/auth/authorizer'`.

- [ ] **Step 3: Write the authorizer module**

Crie `packages/live/src/auth/authorizer.ts`:

```ts
import type { LiveMeta } from '../metadata';
import type { LiveInputs, LiveScope } from '../shared/inputs';

export interface LiveAuthorizationRequest {
    resourceId: string;
    controllerName: string;
    handlerName: string;
    meta: LiveMeta;
    inputs: LiveInputs;
    scope: LiveScope;
    connectionId: string;
}

/**
 * Decides whether one connection may hold one subscription.
 *
 * Called when the subscription is created and again whenever the connection's
 * `auth:` key is invalidated. Returning false ends that connection's
 * subscription; it never affects the other subscribers of a shared instance.
 */
export interface LiveAuthorizer {
    authorize(request: LiveAuthorizationRequest): boolean | Promise<boolean>;
}

/** Default. The scope already isolates instances, so nothing extra is refused. */
export class AllowAllAuthorizer implements LiveAuthorizer {
    authorize(): boolean {
        return true;
    }
}

const AUTH_PREFIX = 'auth:';

export function isAuthKey(key: string): boolean {
    return key.startsWith(AUTH_PREFIX);
}

/**
 * The authorization keys a connection with this scope answers to.
 *
 * Same two-level shape as the ORM keys: `auth:principal#42` is contained by
 * `auth:principal`, so invalidating the parent re-checks everyone.
 */
export function authKeysOf(scope: LiveScope): string[] {
    const keys: string[] = [];

    if (scope.principal !== undefined && scope.principal !== null && scope.principal !== '') {
        keys.push(`${AUTH_PREFIX}principal#${scope.principal}`);
    }

    if (scope.tenant !== undefined && scope.tenant !== null && scope.tenant !== '') {
        keys.push(`${AUTH_PREFIX}tenant#${scope.tenant}`);
    }

    return keys;
}
```

- [ ] **Step 4: Teach the engine to authorize**

Em `packages/live/src/LiveEngine.ts`, seis edições.

**4a.** Acrescente aos imports do topo:

```ts
import { AllowAllAuthorizer, authKeysOf, isAuthKey, type LiveAuthorizer } from './auth/authorizer';
import { ancestorsOf, type DepKey } from './graph/dep-key';
```

**4b.** Acrescente dois campos ao lado dos existentes, logo abaixo de `private readonly pending = new Set<string>();`:

```ts
    /** Scope of each connection, as resolved at subscribe time. */
    private readonly scopes = new Map<string, LiveScope>();
    /** connectionId → instanceId → decision. Cleared when an `auth:` key fires. */
    private readonly authorized = new Map<string, Map<string, boolean>>();
```

**4c.** Acrescente o sétimo parâmetro do construtor, com default:

```ts
    constructor(
        private readonly resources: ResourceRegistry,
        private readonly graph: DependencyGraph,
        private readonly subs: SubscriptionRegistry,
        private readonly bus: InvalidationBus,
        private readonly transport: LiveTransport,
        private readonly config: LiveConfig,
        private readonly authorizer: LiveAuthorizer = new AllowAllAuthorizer()
    ) {}
```

**4d.** Em `subscribe`, logo depois do bloco `try/catch` que calcula `instanceId` e antes de `const known = this.instances.has(instanceId);`, insira:

```ts
        this.scopes.set(connectionId, scope);

        const allowed = await this.checkAuthorization(connectionId, instanceId, resource, inputs, scope);

        if (!allowed) {
            this.fail(
                connectionId,
                sid,
                'forbidden',
                `This connection is not allowed to subscribe to "${resourceId}".`
            );
            return;
        }
```

**4e.** Substitua `broadcast`, `release` e `dropConnection` pelas versões abaixo, e acrescente `checkAuthorization`, `reauthorize` e `revoke` na seção de internals:

```ts
    private release(connectionId: string, sid: string): void {
        const owned = this.bindings.get(connectionId);
        const instanceId = owned?.get(sid);

        if (!owned || !instanceId) {
            return;
        }

        owned.delete(sid);
        this.authorized.get(connectionId)?.delete(instanceId);
        this.subs.unsubscribe(connectionId, instanceId);
        this.scheduleDrop(instanceId);
    }

    private async checkAuthorization(
        connectionId: string,
        instanceId: string,
        resource: LiveResource,
        inputs: LiveInputs,
        scope: LiveScope
    ): Promise<boolean> {
        let perConnection = this.authorized.get(connectionId);

        if (!perConnection) {
            perConnection = new Map<string, boolean>();
            this.authorized.set(connectionId, perConnection);
        }

        const cached = perConnection.get(instanceId);

        if (cached !== undefined) {
            return cached;
        }

        let allowed: boolean;

        try {
            allowed = await this.authorizer.authorize({
                resourceId: resource.id,
                controllerName: resource.controllerName,
                handlerName: resource.handlerName,
                meta: resource.meta,
                inputs,
                scope,
                connectionId
            });
        } catch {
            // An authorizer that throws is a denial. Failing open here would
            // hand out data on a bug in application code.
            allowed = false;
        }

        perConnection.set(instanceId, allowed);
        return allowed;
    }

    /** An `auth:` key fired: drop the cached decisions it covers and re-ask. */
    private reauthorize(key: DepKey): void {
        for (const [connectionId, scope] of this.scopes) {
            const affected = authKeysOf(scope).some(owned => ancestorsOf(owned).includes(key));

            if (!affected) {
                continue;
            }

            this.authorized.delete(connectionId);

            const owned = this.bindings.get(connectionId);

            if (!owned) {
                continue;
            }

            for (const instanceId of new Set(owned.values())) {
                const instance = this.instances.get(instanceId);

                if (!instance) {
                    continue;
                }

                void this.checkAuthorization(connectionId, instanceId, instance.resource, instance.inputs, scope)
                    .then(allowed => {
                        if (!allowed) {
                            this.revoke(connectionId, instanceId);
                        }
                    });
            }
        }
    }

    /** End one connection's hold on one instance, telling it why. */
    private revoke(connectionId: string, instanceId: string): void {
        for (const sid of this.sidsFor(connectionId, instanceId)) {
            this.send(connectionId, {
                t: 'error',
                sid,
                code: 'forbidden',
                message: 'This subscription is no longer authorized for this connection.'
            });
            this.release(connectionId, sid);
        }
    }

    private async broadcast(
        instance: LiveInstance,
        build: (sid: string) => ServerMessage
    ): Promise<void> {
        for (const connectionId of [...this.subs.connectionsOf(instance.id)]) {
            const scope = this.scopes.get(connectionId);
            const allowed = scope
                ? await this.checkAuthorization(connectionId, instance.id, instance.resource, instance.inputs, scope)
                : false;

            if (!allowed) {
                this.revoke(connectionId, instance.id);
                continue;
            }

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

    dropConnection(connectionId: string): void {
        const owned = this.bindings.get(connectionId);

        if (owned) {
            for (const sid of [...owned.keys()]) {
                this.release(connectionId, sid);
            }
        }

        this.bindings.delete(connectionId);
        this.backpressure.delete(connectionId);
        this.scopes.delete(connectionId);
        this.authorized.delete(connectionId);
    }
```

Atenção a `dropConnection`: ele é público e vive na parte de cima do arquivo, acima do comentário `// internals`. Não mova o método para baixo — acrescente as duas linhas novas (`this.scopes.delete` e `this.authorized.delete`) ao corpo que já está lá.

**4f.** Em `onInvalidation`, desvie as chaves de autorização antes de consultar o grafo, e torne os dois `broadcast` de `runCompute` aguardados:

```ts
    private onInvalidation(events: InvalidationEvent[]): void {
        for (const event of events) {
            if (isAuthKey(event.key)) {
                // Not data: nothing to recompute, only permissions to re-check.
                this.reauthorize(event.key);
                continue;
            }

            for (const instanceId of this.graph.resolve(event)) {
                // Grace-held instances have no subscribers but are still cached.
                if (this.instances.has(instanceId)) {
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
```

Em `runCompute`, troque as duas chamadas por `await this.broadcast(...)`:

```ts
        } catch (error) {
            await this.broadcast(instance, sid => ({ t: 'stale', sid, reason: (error as Error).message }));
            return;
        }
```

```ts
        await this.broadcast(instance, sid => ({
            t: 'patch',
            sid,
            from,
            to: instance.revision,
            hash,
            ops
        }));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/live/test/authorization.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 6: Accept an authorizer in the plugin**

Em `packages/live/src/LivePlugin.ts`, acrescente o import, a opção e o argumento:

```ts
import { AllowAllAuthorizer, type LiveAuthorizer } from './auth/authorizer';
```

Em `LivePluginOptions`, depois de `scopeResolver`:

```ts
    /**
     * Decides whether a connection may hold a subscription, and is re-asked
     * whenever `LiveService.invalidate('auth:principal#<id>')` fires.
     */
    authorizer?: LiveAuthorizer;
```

E na construção do engine:

```ts
        const engine = new LiveEngine(
            resources,
            graph,
            subs,
            bus,
            transport,
            config,
            options.authorizer ?? new AllowAllAuthorizer()
        );
```

- [ ] **Step 7: Export the new surface**

Em `packages/live/src/index.ts`, depois do bloco de escopo:

```ts
// Authorization
export { AllowAllAuthorizer, authKeysOf, isAuthKey } from './auth/authorizer';
export type { LiveAuthorizationRequest, LiveAuthorizer } from './auth/authorizer';
```

- [ ] **Step 8: Run the whole live suite**

Run: `bun test packages/live`
Expected: PASS. Os testes da Fase 1 constroem o `LiveEngine` com seis argumentos e continuam válidos por causa do default.

- [ ] **Step 9: Commit**

```bash
git add packages/live/src/auth packages/live/src/LiveEngine.ts packages/live/src/LivePlugin.ts packages/live/src/index.ts packages/live/test/authorization.test.ts
git commit -m "feat(live): re-evaluate authorization per subscriber, not per instance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: `PgListener` — a conexão que fica ouvindo

Esta é a task de maior risco do plano, e por isso ela começa com um teste que pode reprovar a abordagem inteira. A documentação publicada do Bun diz, em `docs/runtime/sql.mdx`, que `LISTEN` e `NOTIFY` **não** estão implementados. Inspecionando o runtime 1.4.0, `sql.listen(channel, onNotify, onListen)` e `sql.notify(channel, payload)` existem e são funções de verdade. Uma das duas fontes está errada, e o Step 1 descobre qual antes de qualquer linha de emissor ser escrita.

**Files:**
- Create: `packages/live/test/pg-listen-probe.test.ts`
- Create: `packages/live/src/emitters/pg-listener.ts`
- Create: `packages/live/test/pg-listener.test.ts`

**Interfaces:**
- Consumes: `SQL` de `bun`.
- Produces:
  - `interface ListenableSql { listen; notify; unsafe; close }`
  - `class PgListener` com `listen(channel, onNotify)`, `notify(channel, payload)`, `check()`, `close()`
  - `interface PgListenerOptions { url; heartbeatMs?; retryMs?; sqlFactory?; onReconnect? }`

- [ ] **Step 1: Probe the runtime before building on it**

Crie `packages/live/test/pg-listen-probe.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { getDriverType } from '../../orm/src/driver/driver-factory';

const URL = process.env.CARNO_TEST_PG_URL
    ?? 'postgres://postgres:postgres@localhost:5433/postgres';

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

describePostgres('Bun LISTEN/NOTIFY', () => {
    test('a notification sent on one connection arrives on the listening one', async () => {
        const listener = new SQL({ url: URL, max: 1 }) as any;
        const writer = new SQL({ url: URL, max: 1 }) as any;
        const received: string[] = [];

        expect(typeof listener.listen).toBe('function');
        expect(typeof writer.notify).toBe('function');

        await listener.listen('carno_probe', (payload: string) => {
            received.push(payload);
        });
        await writer.notify('carno_probe', 'hello');

        const deadline = Date.now() + 3000;

        while (received.length === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        await listener.close();
        await writer.close();

        expect(received).toEqual(['hello']);
    });
});
```

- [ ] **Step 2: Run the probe**

Run: `docker compose up -d db && bun test packages/live/test/pg-listen-probe.test.ts`
Expected: PASS.

**Se falhar, pare o plano aqui e leia isto.** Há três desfechos:

1. **`listen` não é função** (o runtime é mais velho do que se pensava): suba o Bun. Se não puder, vá para o desfecho 3.
2. **`listen` existe mas a notificação não chega:** verifique se o `pg_notify` está sendo emitido pela mesma base (`\c` correto) e se o canal bate. Um `SELECT pg_notify('carno_probe','x')` via `writer.unsafe(...)` no lugar do `writer.notify(...)` distingue "o notify do Bun está quebrado" de "o listen do Bun está quebrado".
3. **Nada funciona:** troque a implementação do `PgListener` por uma **outbox**: o trigger insere em `carno_live_outbox (id bigserial, table_name text, row_id text, columns text[], created_at timestamptz default now())` em vez de chamar `pg_notify`, e o `PgListener` vira um poller que faz `DELETE FROM carno_live_outbox WHERE id <= $lastId RETURNING *` a cada `pollMs` (comece em 250). **A interface pública do `PgListener` e tudo daí para cima não mudam** — é por isso que ele é uma classe separada. Registre a troca aqui no plano, e some `pollMs` aos defaults globais.

- [ ] **Step 3: Write the failing unit test**

Crie `packages/live/test/pg-listener.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { PgListener, type ListenableSql } from '../src/emitters/pg-listener';

class FakeSql implements ListenableSql {
    readonly listened: string[] = [];
    readonly notified: { channel: string; payload: string }[] = [];
    readonly handlers = new Map<string, (payload: string) => void>();
    healthy = true;
    closed = false;

    async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
        this.listened.push(channel);
        this.handlers.set(channel, onNotify);
    }

    async notify(channel: string, payload = ''): Promise<void> {
        this.notified.push({ channel, payload });
    }

    async unsafe(): Promise<void> {
        if (!this.healthy) {
            throw new Error('connection lost');
        }
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    emit(channel: string, payload: string): void {
        this.handlers.get(channel)?.(payload);
    }
}

function build() {
    const created: FakeSql[] = [];
    let reconnects = 0;
    const listener = new PgListener({
        url: 'postgres://ignored',
        heartbeatMs: 0,
        retryMs: 1,
        sqlFactory: () => {
            const sql = new FakeSql();
            created.push(sql);
            return sql;
        },
        onReconnect: () => {
            reconnects += 1;
        }
    });

    return { listener, created, reconnects: () => reconnects };
}

describe('PgListener', () => {
    test('subscribes the channel and delivers payloads', async () => {
        const { listener, created } = build();
        const seen: string[] = [];

        await listener.listen('carno_live', payload => seen.push(payload));
        created[0].emit('carno_live', '{"t":"users"}');

        expect(created[0].listened).toEqual(['carno_live']);
        expect(seen).toEqual(['{"t":"users"}']);

        await listener.close();
    });

    test('a second channel reuses the same connection', async () => {
        const { listener, created } = build();

        await listener.listen('one', () => {});
        await listener.listen('two', () => {});

        expect(created).toHaveLength(1);
        expect(created[0].listened).toEqual(['one', 'two']);

        await listener.close();
    });

    test('a dead connection is rebuilt and every channel is re-listened', async () => {
        const { listener, created, reconnects } = build();
        const seen: string[] = [];

        await listener.listen('carno_live', payload => seen.push(payload));
        created[0].healthy = false;

        await listener.check();

        expect(created).toHaveLength(2);
        expect(created[0].closed).toBe(true);
        expect(created[1].listened).toEqual(['carno_live']);
        expect(reconnects()).toBe(1);

        created[1].emit('carno_live', 'after');
        expect(seen).toEqual(['after']);

        await listener.close();
    });

    test('a healthy connection is left alone', async () => {
        const { listener, created, reconnects } = build();

        await listener.listen('carno_live', () => {});
        await listener.check();

        expect(created).toHaveLength(1);
        expect(reconnects()).toBe(0);

        await listener.close();
    });

    test('notify goes out on the same connection', async () => {
        const { listener, created } = build();

        await listener.notify('carno_bus', 'payload');

        expect(created[0].notified).toEqual([{ channel: 'carno_bus', payload: 'payload' }]);

        await listener.close();
    });

    test('close shuts the connection and stops reconnecting', async () => {
        const { listener, created } = build();

        await listener.listen('carno_live', () => {});
        await listener.close();

        expect(created[0].closed).toBe(true);

        await listener.check();
        expect(created).toHaveLength(1);
    });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test packages/live/test/pg-listener.test.ts`
Expected: FAIL — `Cannot find module '../src/emitters/pg-listener'`.

- [ ] **Step 5: Write the listener**

Crie `packages/live/src/emitters/pg-listener.ts`:

```ts
import { SQL } from 'bun';

/**
 * The slice of Bun's Postgres client this module needs.
 *
 * Bun 1.4 implements `listen` and `notify` at runtime, but `@types/bun` does
 * not declare them and the published docs still list them as unimplemented.
 * Declaring the slice here keeps the cast in one place, and makes the whole
 * thing injectable so the unit tests need no database.
 */
export interface ListenableSql {
    listen(channel: string, onNotify: (payload: string) => void): Promise<unknown>;
    notify(channel: string, payload?: string): Promise<unknown>;
    unsafe(query: string): Promise<unknown>;
    close(): Promise<void>;
}

export interface PgListenerOptions {
    url: string;
    /** Liveness check interval. Zero disables the timer; `check()` still works. */
    heartbeatMs?: number;
    /** Delay between reconnection attempts. */
    retryMs?: number;
    /** Injected in tests. Defaults to a dedicated single Bun connection. */
    sqlFactory?: (url: string) => ListenableSql;
    /**
     * Fired after the connection came back and every channel was re-listened.
     *
     * Whatever was published while the socket was down is gone with no trace,
     * so the caller has to assume the worst — see PgNotifyEmitter.
     */
    onReconnect?: () => void;
}

const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_RETRY_MS = 1000;

function defaultSqlFactory(url: string): ListenableSql {
    // A LISTEN connection cannot be shared with the query pool: it sits open
    // waiting for asynchronous notifications, so it gets its own socket.
    return new SQL({ url, max: 1 }) as unknown as ListenableSql;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One dedicated Postgres connection held open for LISTEN, with reconnection. */
export class PgListener {
    private sql: ListenableSql | null = null;
    private readonly channels = new Map<string, (payload: string) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private opening: Promise<void> | null = null;
    private closed = false;

    constructor(private readonly options: PgListenerOptions) {}

    async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
        const known = this.channels.has(channel);
        this.channels.set(channel, onNotify);

        if (!this.sql) {
            // `open()` subscribes every registered channel, this one included.
            await this.connect();
            return;
        }

        if (!known) {
            await this.sql.listen(channel, onNotify);
        }
    }

    async notify(channel: string, payload: string): Promise<void> {
        await this.connect();
        await this.sql?.notify(channel, payload);
    }

    /** One liveness probe. Called by the heartbeat and directly by tests. */
    async check(): Promise<void> {
        if (this.closed || !this.sql) {
            return;
        }

        try {
            await this.sql.unsafe('SELECT 1');
        } catch {
            await this.reconnect();
        }
    }

    async close(): Promise<void> {
        this.closed = true;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        const sql = this.sql;
        this.sql = null;

        try {
            await sql?.close();
        } catch {
            // Already gone. Nothing to do and nothing to report.
        }
    }

    // ------------------------------------------------------------ internals

    private factory(): (url: string) => ListenableSql {
        return this.options.sqlFactory ?? defaultSqlFactory;
    }

    private async connect(): Promise<void> {
        if (this.sql || this.closed) {
            return;
        }

        if (!this.opening) {
            this.opening = this.open().finally(() => {
                this.opening = null;
            });
        }

        await this.opening;
    }

    private async open(): Promise<void> {
        const sql = this.factory()(this.options.url);

        for (const [channel, handler] of this.channels) {
            await sql.listen(channel, handler);
        }

        this.sql = sql;
        this.startHeartbeat();
    }

    private startHeartbeat(): void {
        const interval = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

        if (this.timer || interval <= 0) {
            return;
        }

        this.timer = setInterval(() => {
            void this.check();
        }, interval);
    }

    private async reconnect(): Promise<void> {
        const previous = this.sql;
        this.sql = null;

        try {
            await previous?.close();
        } catch {
            // The socket is what just failed; closing it is best effort.
        }

        while (!this.closed) {
            try {
                await this.open();
                this.options.onReconnect?.();
                return;
            } catch {
                this.sql = null;
                await delay(this.options.retryMs ?? DEFAULT_RETRY_MS);
            }
        }
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/live/test/pg-listener.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 7: Prove it against a real database**

Acrescente ao fim de `packages/live/test/pg-listen-probe.test.ts`:

```ts
describePostgres('PgListener against a real database', () => {
    test('delivers a notification through the listener', async () => {
        const { PgListener } = await import('../src/emitters/pg-listener');
        const listener = new PgListener({ url: URL, heartbeatMs: 0 });
        const seen: string[] = [];

        await listener.listen('carno_probe_listener', payload => seen.push(payload));
        await listener.notify('carno_probe_listener', '{"t":"users","i":"7"}');

        const deadline = Date.now() + 3000;

        while (seen.length === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        await listener.close();

        expect(seen).toEqual(['{"t":"users","i":"7"}']);
    });
});
```

Nota: `notify` e `listen` saem pela **mesma** conexão aqui. Postgres entrega a notificação à própria sessão que a emitiu, então isto é um teste válido de ida e volta — e é também o caminho que o `PgNotifyBus` usa, o que torna a checagem dupla.

- [ ] **Step 8: Run it**

Run: `bun test packages/live/test/pg-listen-probe.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 9: Commit**

```bash
git add packages/live/src/emitters/pg-listener.ts packages/live/test/pg-listener.test.ts packages/live/test/pg-listen-probe.test.ts
git commit -m "feat(live): add a dedicated LISTEN connection with heartbeat and reconnect

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: `PgNotifyEmitter` — a escrita que não passou pelo ORM

Este é o critério de aceite 2: um `UPDATE` no `psql`, uma migration, um serviço legado em outra linguagem — qualquer escrita na tabela chega na tela. O trigger produz **tabela + PK + colunas alteradas**, que é exatamente o vocabulário que o `AppEmitter` já fala. Os dois emissores não precisam de tradutor entre eles.

**Files:**
- Create: `packages/live/src/emitters/pg-trigger-sql.ts`
- Create: `packages/live/src/emitters/pg-notify-emitter.ts`
- Modify: `packages/live/src/graph/dep-key.ts` (acrescenta `tableOfKey`)
- Modify: `packages/live/src/emitters/AppEmitter.ts`
- Test: `packages/live/test/pg-notify-emitter.test.ts` (criar)
- Test: `packages/live/test/pg-notify-integration.test.ts` (criar)

**Interfaces:**
- Consumes: `PgListener` (Task 4); `rowKey`, `tableKey` (`src/graph/dep-key.ts`); `InvalidationEvent` (`src/graph/types.ts`).
- Produces:
  - `assertIdentifier(kind, value)`, `createFunctionSql(maxPayloadBytes)`, `createTriggerSql(table, primaryKey, channel)`, `dropTriggerSql(table)`, `triggerNameOf(table)`
  - `eventsFromPayload(raw: string): InvalidationEvent[]`
  - `class PgNotifyEmitter` com `attach()`, `detach()`, `uninstall()`, `coveredTables()`
  - `tableOfKey(key: DepKey): string | null`
  - `AppEmitter.setCoveredTables(tables: Iterable<string>)`

- [ ] **Step 1: Write the failing unit test**

Crie `packages/live/test/pg-notify-emitter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
    UnsafeIdentifierError,
    assertIdentifier,
    createFunctionSql,
    createTriggerSql,
    dropTriggerSql,
    triggerNameOf
} from '../src/emitters/pg-trigger-sql';
import { eventsFromPayload } from '../src/emitters/pg-notify-emitter';

describe('trigger SQL', () => {
    test('refuses an identifier that is not a bare name', () => {
        expect(() => assertIdentifier('table', 'users; DROP TABLE users')).toThrow(UnsafeIdentifierError);
        expect(() => assertIdentifier('table', 'public.users')).toThrow(UnsafeIdentifierError);
        expect(() => assertIdentifier('table', '"users"')).toThrow(UnsafeIdentifierError);
        expect(assertIdentifier('table', 'live_tasks')).toBe('live_tasks');
    });

    test('names the trigger after the table', () => {
        expect(triggerNameOf('live_tasks')).toBe('carno_live_live_tasks');
    });

    test('the trigger fires on every write and carries the key column', () => {
        const sql = createTriggerSql('live_tasks', 'id', 'carno_live');

        expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON live_tasks');
        expect(sql).toContain('FOR EACH ROW');
        expect(sql).toContain(`EXECUTE FUNCTION carno_live_notify('id', 'carno_live')`);
        expect(sql).toContain('DROP TRIGGER IF EXISTS carno_live_live_tasks ON live_tasks');
    });

    test('the function refuses to notify when an UPDATE changed nothing', () => {
        const sql = createFunctionSql(7000);

        expect(sql).toContain('IF changed IS NULL THEN');
        expect(sql).toContain('octet_length(payload) > 7000');
        expect(sql).toContain('PERFORM pg_notify(channel, payload)');
    });

    test('drop is idempotent', () => {
        expect(dropTriggerSql('live_tasks')).toBe(
            'DROP TRIGGER IF EXISTS carno_live_live_tasks ON live_tasks;'
        );
    });
});

describe('eventsFromPayload', () => {
    test('a row write becomes a row key with its columns', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":["title"]}')).toEqual([
            { key: 'orm:live_tasks#42', columns: ['title'] }
        ]);
    });

    test('a write with no columns is a wildcard', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":null}')).toEqual([
            { key: 'orm:live_tasks#42', columns: null }
        ]);
    });

    test('an empty column list is a wildcard, not an empty filter', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":[]}')).toEqual([
            { key: 'orm:live_tasks#42', columns: null }
        ]);
    });

    test('a payload with no id degrades to the whole table', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":null,"c":null}')).toEqual([
            { key: 'orm:live_tasks', columns: null }
        ]);
    });

    test('garbage on the channel is ignored, not thrown', () => {
        expect(eventsFromPayload('not json')).toEqual([]);
        expect(eventsFromPayload('{"i":"42"}')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/pg-notify-emitter.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Write the trigger SQL module**

Crie `packages/live/src/emitters/pg-trigger-sql.ts`:

```ts
/**
 * The SQL the Postgres emitter installs.
 *
 * It lives in its own module with no I/O so it can be asserted on without a
 * database, and so the one place that concatenates identifiers into SQL is one
 * short file you can read end to end.
 */

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class UnsafeIdentifierError extends Error {
    constructor(kind: string, value: string) {
        super(
            `Refusing to build SQL with an unsafe ${kind}: ${JSON.stringify(value)}. ` +
            `Only bare names matching [A-Za-z_][A-Za-z0-9_]* are accepted.`
        );
        this.name = 'UnsafeIdentifierError';
    }
}

/** Every identifier interpolated into the DDL below passes through here. */
export function assertIdentifier(kind: string, value: string): string {
    if (!BARE_IDENTIFIER.test(value)) {
        throw new UnsafeIdentifierError(kind, value);
    }

    return value;
}

export const TRIGGER_FUNCTION_NAME = 'carno_live_notify';

export function triggerNameOf(table: string): string {
    return `carno_live_${assertIdentifier('table', table)}`;
}

/**
 * The shared trigger function. Installed once; every table's trigger passes it
 * the primary key column and the channel as arguments.
 *
 * Two decisions are baked in here rather than on the JavaScript side:
 * an UPDATE whose jsonb diff is empty does not notify at all, because a write
 * that changed nothing must not wake a single subscriber; and a payload over
 * the ceiling degrades to the whole table instead of being truncated into
 * something that would parse as a different row.
 */
export function createFunctionSql(maxPayloadBytes: number): string {
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0) {
        throw new Error(`maxPayloadBytes must be a positive integer, got ${maxPayloadBytes}.`);
    }

    return `
CREATE OR REPLACE FUNCTION ${TRIGGER_FUNCTION_NAME}() RETURNS trigger AS $carno$
DECLARE
  pk_column text := TG_ARGV[0];
  channel text := TG_ARGV[1];
  new_row jsonb;
  old_row jsonb;
  changed text[];
  row_id text;
  payload text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    new_row := to_jsonb(OLD);
  ELSE
    new_row := to_jsonb(NEW);
  END IF;

  row_id := new_row ->> pk_column;

  IF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);

    SELECT array_agg(entry.key ORDER BY entry.key) INTO changed
    FROM jsonb_each(new_row) AS entry
    WHERE entry.value IS DISTINCT FROM (old_row -> entry.key);

    IF changed IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  payload := json_build_object('t', TG_TABLE_NAME, 'i', row_id, 'c', changed)::text;

  IF octet_length(payload) > ${maxPayloadBytes} THEN
    payload := json_build_object('t', TG_TABLE_NAME, 'i', NULL, 'c', NULL)::text;
  END IF;

  PERFORM pg_notify(channel, payload);
  RETURN NULL;
END;
$carno$ LANGUAGE plpgsql;
`.trim();
}

export function createTriggerSql(table: string, primaryKey: string, channel: string): string {
    const safeTable = assertIdentifier('table', table);
    const safeKey = assertIdentifier('primary key column', primaryKey);
    const safeChannel = assertIdentifier('channel', channel);
    const trigger = triggerNameOf(safeTable);

    return `
DROP TRIGGER IF EXISTS ${trigger} ON ${safeTable};
CREATE TRIGGER ${trigger}
AFTER INSERT OR UPDATE OR DELETE ON ${safeTable}
FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FUNCTION_NAME}('${safeKey}', '${safeChannel}');
`.trim();
}

export function dropTriggerSql(table: string): string {
    return `DROP TRIGGER IF EXISTS ${triggerNameOf(table)} ON ${assertIdentifier('table', table)};`;
}
```

- [ ] **Step 4: Add `tableOfKey` to the key module**

Em `packages/live/src/graph/dep-key.ts`, no fim do arquivo:

```ts
/** The table an ORM key names, or null for a key from another namespace. */
export function tableOfKey(key: DepKey): string | null {
    if (!key.startsWith('orm:')) {
        return null;
    }

    const rest = key.slice('orm:'.length);
    const separator = rest.indexOf(ROW_SEPARATOR);

    return separator === -1 ? rest : rest.slice(0, separator);
}
```

- [ ] **Step 5: Write the emitter**

Crie `packages/live/src/emitters/pg-notify-emitter.ts`:

```ts
import { rowKey, tableKey } from '../graph/dep-key';
import type { InvalidationEvent } from '../graph/types';
import { PgListener } from './pg-listener';
import { createFunctionSql, createTriggerSql, dropTriggerSql } from './pg-trigger-sql';

export interface PgNotifyTable {
    /** Table name as it exists in the database, unqualified. */
    table: string;
    /** Primary key column, as it exists in the database. */
    primaryKey: string;
}

export interface PgNotifyEmitterOptions {
    tables: PgNotifyTable[];
    /** Connection string. Defaults to the ORM's own. */
    url: string;
    /** Runs the DDL. Defaults to the ORM driver's `executeSql`. */
    execute: (sql: string) => Promise<unknown>;
    channel?: string;
    maxPayloadBytes?: number;
    heartbeatMs?: number;
    retryMs?: number;
    /** Injected in tests. */
    listener?: PgListener;
}

export const DEFAULT_PG_CHANNEL = 'carno_live';
export const DEFAULT_PG_MAX_PAYLOAD_BYTES = 7000;

/**
 * Turn one trigger payload into invalidation events.
 *
 * Exported on its own because it is the whole translation layer between
 * Postgres and the graph, and it is worth testing without a database.
 */
export function eventsFromPayload(raw: string): InvalidationEvent[] {
    let parsed: { t?: unknown; i?: unknown; c?: unknown };

    try {
        parsed = JSON.parse(raw) as { t?: unknown; i?: unknown; c?: unknown };
    } catch {
        // Someone else is using our channel. Not our problem, and not a crash.
        return [];
    }

    if (!parsed || typeof parsed.t !== 'string' || parsed.t === '') {
        return [];
    }

    const table = parsed.t;
    const columns = Array.isArray(parsed.c)
        ? (parsed.c.filter(item => typeof item === 'string') as string[])
        : [];
    const id = typeof parsed.i === 'string' || typeof parsed.i === 'number' ? parsed.i : null;

    return [{
        key: id === null ? tableKey(table) : rowKey(table, id),
        // An empty list is "we do not know which columns", not "no columns".
        columns: columns.length > 0 ? columns : null
    }];
}

/**
 * The second emitter of §4.4: writes that never went through @carno.js/orm.
 *
 * A trigger per watched table produces table + primary key + changed columns,
 * which is the same key vocabulary the application emitter produces. The graph
 * cannot tell them apart, and does not need to.
 */
export class PgNotifyEmitter {
    private readonly listener: PgListener;
    private readonly channel: string;
    private attached = false;

    constructor(
        private readonly deliver: (events: InvalidationEvent[]) => void,
        private readonly options: PgNotifyEmitterOptions
    ) {
        this.channel = options.channel ?? DEFAULT_PG_CHANNEL;
        this.listener = options.listener ?? new PgListener({
            url: options.url,
            heartbeatMs: options.heartbeatMs,
            retryMs: options.retryMs,
            onReconnect: () => this.onReconnect()
        });
    }

    /** Tables this emitter announces, so the ORM emitter can skip them. */
    coveredTables(): Set<string> {
        return new Set(this.options.tables.map(entry => entry.table));
    }

    /** Install the trigger function and one trigger per watched table. */
    async install(): Promise<void> {
        await this.options.execute(
            createFunctionSql(this.options.maxPayloadBytes ?? DEFAULT_PG_MAX_PAYLOAD_BYTES)
        );

        for (const entry of this.options.tables) {
            await this.options.execute(createTriggerSql(entry.table, entry.primaryKey, this.channel));
        }
    }

    async attach(): Promise<void> {
        if (this.attached) {
            return;
        }

        this.attached = true;
        await this.install();
        await this.listener.listen(this.channel, payload => {
            const events = eventsFromPayload(payload);

            if (events.length > 0) {
                this.deliver(events);
            }
        });
    }

    async detach(): Promise<void> {
        this.attached = false;
        await this.listener.close();
    }

    /** Remove the triggers. The function is left in place; it is harmless. */
    async uninstall(): Promise<void> {
        for (const entry of this.options.tables) {
            await this.options.execute(dropTriggerSql(entry.table));
        }
    }

    /**
     * Whatever was written while the socket was down arrived nowhere, and there
     * is no way to ask Postgres what we missed. The only correct move is to
     * assume everything watched is stale.
     */
    private onReconnect(): void {
        this.deliver(this.options.tables.map(entry => ({
            key: tableKey(entry.table),
            columns: null
        })));
    }
}
```

- [ ] **Step 6: Teach `AppEmitter` to skip covered tables**

Em `packages/live/src/emitters/AppEmitter.ts`, acrescente `tableOfKey` ao import de `dep-key` (o arquivo ainda não importa dele — acrescente a linha), um campo, um setter, e troque o corpo de `onWrite`:

```ts
import { tableOfKey } from '../graph/dep-key';
```

```ts
export class AppEmitter {
    /** Tables announced by another emitter, so we do not announce them twice. */
    private covered = new Set<string>();

    constructor(
        private readonly bus: InvalidationBus,
        private readonly config: LiveConfig
    ) {}

    setCoveredTables(tables: Iterable<string>): void {
        this.covered = new Set(tables);
    }
```

```ts
        statementObserver.onWrite((statement: Statement<any>) => {
            const events = writeEvents(statement, this.config.maxKeysPerRead);
            // A table watched by the Postgres emitter already announces itself
            // through the trigger, on every node at once. Publishing here too
            // would only buy a duplicate recompute.
            const ours = events.filter(event => !this.covered.has(tableOfKey(event.key) ?? ''));

            this.bus.publish(ours);
        });
```

- [ ] **Step 7: Test the skip**

Acrescente a `packages/live/test/pg-notify-emitter.test.ts`:

```ts
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { AppEmitter } from '../src/emitters/AppEmitter';
import { InProcessBus } from '../src/bus/InProcessBus';
import { statementObserver } from '../../orm/src';
import type { InvalidationEvent } from '../src/graph/types';

describe('AppEmitter with a covered table', () => {
    test('does not publish writes announced by another emitter', () => {
        const bus = new InProcessBus();
        const published: InvalidationEvent[] = [];
        bus.subscribe(events => published.push(...events));

        const emitter = new AppEmitter(bus, DEFAULT_LIVE_CONFIG);
        emitter.setCoveredTables(['live_tasks']);
        emitter.attach();

        statementObserver.notifyWrite({
            statement: 'update',
            table: 'live_tasks',
            where: 'id = 1',
            values: { title: 'x' },
            primaryKeyColumnName: 'id'
        } as any);
        statementObserver.notifyWrite({
            statement: 'update',
            table: 'other_table',
            where: 'id = 1',
            values: { title: 'x' },
            primaryKeyColumnName: 'id'
        } as any);

        emitter.detach();

        expect(published).toEqual([{ key: 'orm:other_table#1', columns: ['title'] }]);
    });
});
```

- [ ] **Step 8: Run the unit tests**

Run: `bun test packages/live/test/pg-notify-emitter.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 9: Prove it against a real database**

Crie `packages/live/test/pg-notify-integration.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { withDatabase } from '../../orm/src/testing';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { PgNotifyEmitter } from '../src/emitters/pg-notify-emitter';
import type { InvalidationEvent } from '../src/graph/types';

const URL = process.env.CARNO_TEST_PG_URL
    ?? 'postgres://postgres:postgres@localhost:5433/postgres';

const TABLE_STATEMENTS = [
    'CREATE TABLE pg_notify_rows (id SERIAL PRIMARY KEY, title TEXT NOT NULL, note TEXT NULL);'
];

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

async function waitFor(events: InvalidationEvent[], count: number): Promise<void> {
    const deadline = Date.now() + 3000;

    while (events.length < count && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

describePostgres('PgNotifyEmitter against a real database', () => {
    test('a raw SQL write that never touched the ORM produces an invalidation', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            const received: InvalidationEvent[] = [];
            const emitter = new PgNotifyEmitter(events => received.push(...events), {
                tables: [{ table: 'pg_notify_rows', primaryKey: 'id' }],
                url: URL,
                execute: sql => executeSql(sql),
                channel: 'carno_live_test',
                heartbeatMs: 0
            });

            await emitter.attach();

            // No ORM, no entity, no repository: this is what a migration, a
            // psql session or a service in another language looks like.
            await executeSql(`INSERT INTO pg_notify_rows (title) VALUES ('first');`);
            await waitFor(received, 1);

            await executeSql(`UPDATE pg_notify_rows SET title = 'second' WHERE id = 1;`);
            await waitFor(received, 2);

            // An update that writes the same value must not wake anyone.
            await executeSql(`UPDATE pg_notify_rows SET title = 'second' WHERE id = 1;`);
            await new Promise(resolve => setTimeout(resolve, 300));

            await executeSql(`DELETE FROM pg_notify_rows WHERE id = 1;`);
            await waitFor(received, 3);

            await emitter.detach();

            expect(received).toEqual([
                { key: 'orm:pg_notify_rows#1', columns: null },
                { key: 'orm:pg_notify_rows#1', columns: ['title'] },
                { key: 'orm:pg_notify_rows#1', columns: null }
            ]);
        });
    });
});
```

- [ ] **Step 10: Run the integration test**

Run: `bun test packages/live/test/pg-notify-integration.test.ts`
Expected: PASS.

**Se o `INSERT` vier com `columns` diferente de `null`:** o `TG_OP = 'INSERT'` não entra no ramo do diff, então `changed` fica `NULL` e o `json_build_object` grava `null`. Se o driver estiver devolvendo `[]` no lugar, `eventsFromPayload` já normaliza para `null` — confira qual dos dois aconteceu antes de mexer no SQL.

**Se nada chegar:** o `withDatabase` derruba e recria o schema a cada teste, e o `SET search_path` vale para a sessão do ORM, não para a do listener. Se a tabela não estiver no `search_path` do listener, o trigger ainda dispara (ele roda na sessão que escreveu), então o sintoma seria outro. Verifique primeiro se `install()` rodou sem erro, imprimindo o SQL.

- [ ] **Step 11: Commit**

```bash
git add packages/live/src/emitters/pg-trigger-sql.ts packages/live/src/emitters/pg-notify-emitter.ts packages/live/src/emitters/AppEmitter.ts packages/live/src/graph/dep-key.ts packages/live/test/pg-notify-emitter.test.ts packages/live/test/pg-notify-integration.test.ts
git commit -m "feat(live): invalidate from Postgres triggers, for writes the ORM never saw

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: `PgNotifyBus` e a ligação no plugin

Com um nó só, `InProcessBus` basta. Com dois, uma escrita feita no nó A precisa chegar às subscrições do nó B — e o `AppEmitter` e o `LiveService.invalidate()` são locais por natureza. O emissor Postgres não tem esse problema: o trigger notifica todos os nós de uma vez. Por isso o bus tem duas entradas, e distinguir as duas é o ponto inteiro desta task: republicar algo que já chegou em todo mundo multiplica a invalidação pelo tamanho do cluster.

**Files:**
- Create: `packages/live/src/bus/PgNotifyBus.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/index.ts`
- Test: `packages/live/test/pg-bus.test.ts` (criar)
- Test: `packages/live/test/pg-notify-integration.test.ts` (existente, acrescentar)

**Interfaces:**
- Consumes: `InvalidationBus`, `InvalidationHandler` (`src/bus/InvalidationBus.ts`); `PgListener`, `ListenableSql` (Task 4); `PgNotifyEmitter`, `PgNotifyTable` (Task 5); `tableOfKey`, `tableKey` (`src/graph/dep-key.ts`).
- Produces:
  - `class PgNotifyBus implements InvalidationBus` com `publish`, `publishLocal`, `subscribe`, `setUrl`, `start`, `stop`, `nodeId`
  - `chunkEvents(events, nodeId, maxPayloadBytes): string[]`
  - `LivePlugin.create({ ..., pgNotify, distributed })`

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/pg-bus.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { PgNotifyBus, chunkEvents } from '../src/bus/PgNotifyBus';
import { PgListener, type ListenableSql } from '../src/emitters/pg-listener';
import type { InvalidationEvent } from '../src/graph/types';

/** Stands in for the Postgres notification bus, shared by several connections. */
class FakeBroker {
    private readonly handlers = new Map<string, Set<(payload: string) => void>>();

    connection(): ListenableSql {
        const broker = this;
        const own = new Set<{ channel: string; handler: (payload: string) => void }>();

        return {
            async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
                let bucket = broker.handlers.get(channel);

                if (!bucket) {
                    bucket = new Set();
                    broker.handlers.set(channel, bucket);
                }

                bucket.add(onNotify);
                own.add({ channel, handler: onNotify });
            },
            async notify(channel: string, payload = ''): Promise<void> {
                // Postgres delivers to every listening session, sender included.
                for (const handler of [...(broker.handlers.get(channel) ?? [])]) {
                    handler(payload);
                }
            },
            async unsafe(): Promise<void> {},
            async close(): Promise<void> {
                for (const entry of own) {
                    broker.handlers.get(entry.channel)?.delete(entry.handler);
                }

                own.clear();
            }
        };
    }
}

function node(broker: FakeBroker, nodeId: string) {
    const received: InvalidationEvent[] = [];
    const bus = new PgNotifyBus({
        url: 'postgres://ignored',
        channel: 'carno_test_bus',
        nodeId,
        listener: new PgListener({
            url: 'postgres://ignored',
            heartbeatMs: 0,
            sqlFactory: () => broker.connection()
        })
    });

    bus.subscribe(events => received.push(...events));

    return { bus, received };
}

describe('chunkEvents', () => {
    test('keeps everything in one frame when it fits', () => {
        const frames = chunkEvents([{ key: 'orm:users#1', columns: null }], 'n1', 7000);

        expect(frames).toHaveLength(1);
        expect(JSON.parse(frames[0])).toEqual({ n: 'n1', e: [{ key: 'orm:users#1', columns: null }] });
    });

    test('splits into frames under the ceiling', () => {
        const events = Array.from({ length: 50 }, (_, index) => ({
            key: `orm:users#${index}`,
            columns: ['name', 'email']
        }));

        const frames = chunkEvents(events, 'n1', 400);

        expect(frames.length).toBeGreaterThan(1);

        for (const frame of frames) {
            expect(Buffer.byteLength(frame, 'utf8')).toBeLessThanOrEqual(400);
        }

        expect(frames.flatMap(frame => JSON.parse(frame).e)).toEqual(events);
    });

    test('one oversized event degrades to its table instead of overflowing', () => {
        const frames = chunkEvents(
            [{ key: 'orm:users#1', columns: Array.from({ length: 200 }, (_, i) => `column_${i}`) }],
            'n1',
            300
        );

        expect(frames).toHaveLength(1);
        expect(JSON.parse(frames[0]).e).toEqual([{ key: 'orm:users', columns: null }]);
    });
});

describe('PgNotifyBus', () => {
    test('an invalidation published on one node arrives on the other', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');
        const b = node(broker, 'b');

        await a.bus.start();
        await b.bus.start();

        a.bus.publish([{ key: 'orm:users#1', columns: ['name'] }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(b.received).toEqual([{ key: 'orm:users#1', columns: ['name'] }]);

        await a.bus.stop();
        await b.bus.stop();
    });

    test('the publishing node delivers locally exactly once', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');

        await a.bus.start();
        a.bus.publish([{ key: 'orm:users#1', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Postgres echoes the notification back to the sender; the node id is
        // what keeps it from becoming a second invalidation.
        expect(a.received).toEqual([{ key: 'orm:users#1', columns: null }]);

        await a.bus.stop();
    });

    test('publishLocal stays on this node', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');
        const b = node(broker, 'b');

        await a.bus.start();
        await b.bus.start();

        a.bus.publishLocal([{ key: 'orm:users#1', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(a.received).toHaveLength(1);
        expect(b.received).toHaveLength(0);

        await a.bus.stop();
        await b.bus.stop();
    });

    test('garbage on the channel is ignored', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');

        await a.bus.start();
        await broker.connection().notify('carno_test_bus', 'not json');
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(a.received).toHaveLength(0);

        await a.bus.stop();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/pg-bus.test.ts`
Expected: FAIL — `Cannot find module '../src/bus/PgNotifyBus'`.

- [ ] **Step 3: Write the bus**

Crie `packages/live/src/bus/PgNotifyBus.ts`. Repare que o listener é criado no `start()`, não no construtor: a URL padrão vem do ORM, que só sabe dela depois do bootstrap.

```ts
import { tableKey, tableOfKey } from '../graph/dep-key';
import type { InvalidationEvent } from '../graph/types';
import { PgListener } from '../emitters/pg-listener';
import type { InvalidationBus, InvalidationHandler } from './InvalidationBus';

export const DEFAULT_PG_BUS_CHANNEL = 'carno_live_bus';
export const DEFAULT_PG_BUS_MAX_PAYLOAD_BYTES = 7000;

export interface PgNotifyBusOptions {
    /** May be empty at construction; `setUrl` fills it before `start()`. */
    url: string;
    channel?: string;
    /** Identifies this process so its own echo can be dropped. */
    nodeId?: string;
    maxPayloadBytes?: number;
    heartbeatMs?: number;
    retryMs?: number;
    /** Injected in tests. */
    listener?: PgListener;
}

interface WireFrame {
    n: string;
    e: InvalidationEvent[];
}

/**
 * Split events into `pg_notify` frames under the payload ceiling.
 *
 * A single event that does not fit on its own degrades to its table key: a
 * coarse invalidation costs CPU, a dropped one costs a screen frozen on stale
 * data.
 */
export function chunkEvents(
    events: InvalidationEvent[],
    nodeId: string,
    maxPayloadBytes: number
): string[] {
    const encode = (items: InvalidationEvent[]): string => JSON.stringify({ n: nodeId, e: items });
    const frames: string[] = [];
    let batch: InvalidationEvent[] = [];

    for (const event of events) {
        let item = event;

        if (Buffer.byteLength(encode([item]), 'utf8') > maxPayloadBytes) {
            const table = tableOfKey(item.key);
            item = { key: table ? tableKey(table) : item.key, columns: null };
        }

        if (batch.length > 0 && Buffer.byteLength(encode([...batch, item]), 'utf8') > maxPayloadBytes) {
            frames.push(encode(batch));
            batch = [item];
            continue;
        }

        batch.push(item);
    }

    if (batch.length > 0) {
        frames.push(encode(batch));
    }

    return frames;
}

/**
 * Invalidation bus across nodes, over `LISTEN/NOTIFY`.
 *
 * Two entry points, on purpose. `publish` is for a source local to this node —
 * the ORM emitter, `LiveService.invalidate()` — and has to reach the others.
 * `publishLocal` is for a source that already reached every node, which is what
 * a Postgres trigger is; re-publishing that would multiply one write by the
 * size of the cluster.
 */
export class PgNotifyBus implements InvalidationBus {
    readonly nodeId: string;

    private readonly handlers = new Set<InvalidationHandler>();
    private readonly channel: string;
    private readonly maxPayloadBytes: number;
    private listener: PgListener | null;
    private url: string;

    constructor(private readonly options: PgNotifyBusOptions) {
        this.nodeId = options.nodeId ?? crypto.randomUUID();
        this.channel = options.channel ?? DEFAULT_PG_BUS_CHANNEL;
        this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_PG_BUS_MAX_PAYLOAD_BYTES;
        this.listener = options.listener ?? null;
        this.url = options.url;
    }

    /** Called by the plugin once the ORM knows where the database is. */
    setUrl(url: string): void {
        this.url = url;
    }

    async start(): Promise<void> {
        if (!this.listener) {
            this.listener = new PgListener({
                url: this.url,
                heartbeatMs: this.options.heartbeatMs,
                retryMs: this.options.retryMs
            });
        }

        await this.listener.listen(this.channel, raw => this.onFrame(raw));
    }

    async stop(): Promise<void> {
        await this.listener?.close();
    }

    publish(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        this.deliver(events);
        void this.broadcast(events);
    }

    /** Deliver here only: the source already reached every node. */
    publishLocal(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        this.deliver(events);
    }

    subscribe(handler: InvalidationHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    // ------------------------------------------------------------ internals

    private async broadcast(events: InvalidationEvent[]): Promise<void> {
        const listener = this.listener;

        if (!listener) {
            console.error('[carno:live] the distributed bus is not started; invalidation stayed local');
            return;
        }

        for (const frame of chunkEvents(events, this.nodeId, this.maxPayloadBytes)) {
            try {
                await listener.notify(this.channel, frame);
            } catch (error) {
                // The other nodes will miss this one. Loud, because the symptom
                // over there is a screen that simply stops updating.
                console.error('[carno:live] failed to broadcast an invalidation', error);
            }
        }
    }

    private onFrame(raw: string): void {
        let frame: WireFrame;

        try {
            frame = JSON.parse(raw) as WireFrame;
        } catch {
            return;
        }

        if (!frame || typeof frame.n !== 'string' || !Array.isArray(frame.e)) {
            return;
        }

        if (frame.n === this.nodeId) {
            // Our own echo. These were delivered locally before being sent.
            return;
        }

        this.deliver(frame.e);
    }

    private deliver(events: InvalidationEvent[]): void {
        for (const handler of this.handlers) {
            try {
                handler(events);
            } catch (error) {
                console.error('[carno:live] invalidation handler failed', error);
            }
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/live/test/pg-bus.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Wire the emitter and the bus into the plugin**

Em `packages/live/src/LivePlugin.ts`, acrescente aos imports:

```ts
import { Orm } from '@carno.js/orm';
import type { InvalidationBus } from './bus/InvalidationBus';
import { PgNotifyBus } from './bus/PgNotifyBus';
import { PgNotifyEmitter, type PgNotifyTable } from './emitters/pg-notify-emitter';
import type { InvalidationEvent } from './graph/types';
```

Acrescente as duas opções a `LivePluginOptions`, depois de `authorizer`:

```ts
    /**
     * Watch these tables with a Postgres trigger, so writes that never went
     * through @carno.js/orm also invalidate. Requires PostgreSQL 11 or newer.
     */
    pgNotify?: {
        tables: PgNotifyTable[];
        /** Defaults to the ORM's own connection string. */
        url?: string;
        channel?: string;
    };
    /** Carry invalidations from this node to the others. */
    distributed?: {
        transport: 'pg-notify';
        url?: string;
        channel?: string;
        nodeId?: string;
    };
```

Substitua a criação do bus (a linha `const bus = new InProcessBus();`) e o corpo do builder. A linha `const emitter = new AppEmitter(bus, config);` fica como está:

```ts
        const distributedBus = options.distributed
            ? new PgNotifyBus({
                url: options.distributed.url ?? '',
                channel: options.distributed.channel,
                nodeId: options.distributed.nodeId
            })
            : null;
        const bus: InvalidationBus = distributedBus ?? new InProcessBus();
```

```ts
        // The builder runs after bootstrap, when the container holds the
        // controller instances and the ORM holds its connection — which is why
        // everything that needs a database URL is started here and not above.
        plugin.wsHandler((container: Container) => {
            for (const ControllerClass of options.controllers) {
                resources.register(ControllerClass, container.get(ControllerClass));
            }

            if (options.pgNotify) {
                const driver = Orm.getInstance().driverInstance;
                const deliver = (events: InvalidationEvent[]): void => {
                    // A trigger already notified every node. Publishing it on
                    // the bus would send it around a second time.
                    if (distributedBus) {
                        distributedBus.publishLocal(events);
                        return;
                    }

                    bus.publish(events);
                };

                const pgEmitter = new PgNotifyEmitter(deliver, {
                    tables: options.pgNotify.tables,
                    url: options.pgNotify.url ?? driver.connectionString,
                    channel: options.pgNotify.channel,
                    execute: sql => driver.executeSql(sql)
                });

                // Two emitters on one table would wake the same instance twice.
                emitter.setCoveredTables(pgEmitter.coveredTables());

                void pgEmitter.attach().catch(error => {
                    console.error('[carno:live] the Postgres emitter failed to attach', error);
                });
            }

            if (distributedBus) {
                if (!options.distributed?.url) {
                    distributedBus.setUrl(Orm.getInstance().driverInstance.connectionString);
                }

                void distributedBus.start().catch(error => {
                    console.error('[carno:live] the distributed bus failed to start', error);
                });
            }

            emitter.attach();
            engine.start();

            return innerBuilder(container);
        }, upgradePaths);
```

- [ ] **Step 6: Export the new surface**

Em `packages/live/src/index.ts`, no bloco de invalidação:

```ts
export { PgNotifyBus, chunkEvents } from './bus/PgNotifyBus';
export type { PgNotifyBusOptions } from './bus/PgNotifyBus';
export { PgNotifyEmitter, eventsFromPayload } from './emitters/pg-notify-emitter';
export type { PgNotifyEmitterOptions, PgNotifyTable } from './emitters/pg-notify-emitter';
export { PgListener } from './emitters/pg-listener';
export type { ListenableSql, PgListenerOptions } from './emitters/pg-listener';
export { tableOfKey } from './graph/dep-key';
```

- [ ] **Step 7: Prove the bus against a real database**

Acrescente ao fim de `packages/live/test/pg-notify-integration.test.ts`:

```ts
import { PgNotifyBus } from '../src/bus/PgNotifyBus';

describePostgres('PgNotifyBus against a real database', () => {
    test('two nodes see each other and not their own echo', async () => {
        const nodeA = new PgNotifyBus({ url: URL, channel: 'carno_bus_test', nodeId: 'node-a' });
        const nodeB = new PgNotifyBus({ url: URL, channel: 'carno_bus_test', nodeId: 'node-b' });
        const seenByA: InvalidationEvent[] = [];
        const seenByB: InvalidationEvent[] = [];

        nodeA.subscribe(events => seenByA.push(...events));
        nodeB.subscribe(events => seenByB.push(...events));

        await nodeA.start();
        await nodeB.start();

        nodeA.publish([{ key: 'orm:users#1', columns: ['name'] }]);
        await waitFor(seenByB, 1);

        await nodeA.stop();
        await nodeB.stop();

        expect(seenByB).toEqual([{ key: 'orm:users#1', columns: ['name'] }]);
        // Delivered locally once, when published; the echo back was dropped.
        expect(seenByA).toEqual([{ key: 'orm:users#1', columns: ['name'] }]);
    });
});
```

- [ ] **Step 8: Run everything**

Run: `bun test packages/live`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/live/src/bus/PgNotifyBus.ts packages/live/src/LivePlugin.ts packages/live/src/index.ts packages/live/test/pg-bus.test.ts packages/live/test/pg-notify-integration.test.ts
git commit -m "feat(live): carry invalidations between nodes over LISTEN/NOTIFY

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: O codegen aprende `@Live()` e passa a emitir descriptors

A §7 quer um descriptor por rota, carregando `method`, `path`, os tipos, e — quando a rota é assinável — `live` e o `resourceId`. `dependsOn` **não** entra: é detalhe de invalidação do servidor e não tem por que viajar no bundle do cliente.

Uma decisão que o revisor precisa ver: o `resourceId` só é emitido para rotas `@Live()`. O teste `generate.spec.ts:44` afirma que nenhum nome de controller vaza para o arquivo gerado, e essa é uma propriedade boa — o cliente não deveria saber como o servidor organiza suas classes. O protocolo de subscrição, porém, endereça o resource por `${Controller}.${handler}`, então para essas rotas o nome tem de aparecer. Emitir só onde é necessário mantém a regra de pé para todo o resto.

**Files:**
- Create: `packages/client/test/fixtures/live-app/tsconfig.json`
- Create: `packages/client/test/fixtures/live-app/src/live.decorator.ts`
- Create: `packages/client/test/fixtures/live-app/src/dto.ts`
- Create: `packages/client/test/fixtures/live-app/src/board.controller.ts`
- Modify: `packages/client/test/helpers.ts`
- Modify: `packages/client/src/codegen/types.ts`
- Modify: `packages/client/src/codegen/scan.ts`
- Modify: `packages/client/src/codegen/emit.ts`
- Test: `packages/client/test/live-codegen.spec.ts` (criar)

**Interfaces:**
- Consumes: `scanProject`, `emitApp`, `resolveClientOptions` (já existentes).
- Produces:
  - `interface RouteLive { shared: 'private' | 'tenant' | 'public'; key?: string }` em `codegen/types.ts`
  - `RouteSchema.live?: RouteLive`
  - `emitApp` passa a emitir `export type HttpMethod`, `export type LiveShared`, `export interface RouteDescriptor<R>` e `export const routes`
  - `liveFixtureRoot` em `test/helpers.ts`

- [ ] **Step 1: Create the fixture**

`packages/client/test/fixtures/live-app/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "baseUrl": ".",
    "paths": {
      "@carno.js/core": ["../../../core/src/index.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

`packages/client/test/fixtures/live-app/src/live.decorator.ts`:

```ts
/**
 * Stand-in for @carno.js/live's @Live(). The scanner matches decorators by
 * name, so the fixture does not have to depend on the live package — which
 * would drag the websocket and orm packages into this program for nothing.
 */
export function Live(options?: {
    key?: string;
    shared?: 'private' | 'tenant' | 'public';
    dependsOn?: string[];
}): MethodDecorator {
    void options;
    return () => {};
}
```

`packages/client/test/fixtures/live-app/src/dto.ts`:

```ts
export interface Card {
    id: string;
    title: string;
    done: boolean;
}

export interface CardFilter {
    q: string;
    limit?: number;
}
```

`packages/client/test/fixtures/live-app/src/board.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card, CardFilter } from './dto';

@Controller('/cards')
export class BoardController {
    @Get()
    @Live({ key: 'id', shared: 'tenant' })
    list(@Query('status') status?: string): Card[] {
        void status;
        return [];
    }

    @Get('/:id')
    @Live()
    byId(@Param('id') id: string): Card {
        return { id, title: '', done: false };
    }

    @Post('/search')
    @Live({ key: 'id' })
    search(@Body() filter: CardFilter): Card[] {
        void filter;
        return [];
    }

    @Post()
    create(@Body() card: Card): Card {
        return card;
    }
}
```

Em `packages/client/test/helpers.ts`, acrescente:

```ts
export const liveFixtureRoot = path.resolve(import.meta.dir, 'fixtures/live-app');
```

- [ ] **Step 2: Write the failing test**

Crie `packages/client/test/live-codegen.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { emitApp } from '../src/codegen/emit';
import { resolveClientOptions } from '../src/codegen/options';
import { scanProject } from '../src/codegen/scan';
import { findRoute, liveFixtureRoot } from './helpers';

function scanLiveFixture() {
    return scanProject(resolveClientOptions({
        root: liveFixtureRoot,
        include: ['src/**/*.ts'],
        output: 'src/generated/app.ts',
        silent: true,
        nodeEnv: 'development',
        force: true
    }));
}

describe('scanning @Live()', () => {
    test('reads shared and key from the decorator', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'get', '/cards')).toMatchObject({
            live: { shared: 'tenant', key: 'id' }
        });
    });

    test('defaults shared to private when the decorator is bare', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'get', '/cards/:id')).toMatchObject({
            live: { shared: 'private' }
        });
        expect((findRoute(routes, 'get', '/cards/:id') as any).live.key).toBeUndefined();
    });

    test('reads @Live() on a POST', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'post', '/cards/search')).toMatchObject({
            live: { shared: 'private', key: 'id' }
        });
    });

    test('leaves a plain route without a live field', () => {
        const { routes } = scanLiveFixture();

        expect((findRoute(routes, 'post', '/cards') as any).live).toBeUndefined();
    });
});

describe('emitting descriptors', () => {
    test('emits one descriptor per route, typed through App', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('export interface RouteDescriptor<R = unknown>');
        expect(content).toContain('export const routes = {');
        expect(content).toContain('method: "get", path: "/cards"');
        expect(content).toContain('as RouteDescriptor<App["cards"]["get"]>');
        expect(content).toContain('as RouteDescriptor<App["cards"][":id"]["get"]>');
    });

    test('carries live and the resource id for subscribable routes only', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('resourceId: "BoardController.list"');
        expect(content).toContain('live: { shared: "tenant", key: "id" }');
        // `create` is a plain POST: no resource id, no live.
        expect(content).not.toContain('resourceId: "BoardController.create"');
    });

    test('still emits the paths constant unchanged in shape', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('export const paths = {');
        expect(content).toContain('list: "/cards"');
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/client/test/live-codegen.spec.ts`
Expected: FAIL — `live` é `undefined` em toda rota e `RouteDescriptor` não existe no output.

- [ ] **Step 4: Add the type**

Em `packages/client/src/codegen/types.ts`, acrescente antes de `RouteSchema` e o campo dentro dela:

```ts
export interface RouteLive {
    shared: 'private' | 'tenant' | 'public';
    /** Field that identifies a row of a returned collection. */
    key?: string;
}
```

```ts
export interface RouteSchema {
    method: HttpMethod;
    path: string;
    relativePath: string;
    pathSource?: string;
    handlerName: string;
    controllerName: string;
    filePath: string;
    params: RouteSlot[];
    query: RouteSlot[];
    headers: RouteSlot[];
    body: RouteSlot[];
    response: string;
    /** Present when the handler carries @Live(). */
    live?: RouteLive;
}
```

- [ ] **Step 5: Read the decorator in the scanner**

Em `packages/client/src/codegen/scan.ts`:

**5a.** Acrescente `RouteLive` ao import de tipos do topo:

```ts
import type { HttpMethod, RouteLive, RouteSchema, RouteSlot, ScanResult, ScanWarning } from './types';
```

**5b.** Acrescente `live` a `CollectedRoute`:

```ts
interface CollectedRoute {
    method: HttpMethod;
    relativePath: string;
    pathSource?: string;
    handlerName: string;
    params: RouteSlot[];
    query: RouteSlot[];
    headers: RouteSlot[];
    body: RouteSlot[];
    response: string;
    live?: RouteLive;
}
```

**5c.** Em `readRoute`, logo antes do `return`, leia o decorator e inclua o campo:

```ts
    const live = readLive(method, checker);

    return {
        method: httpMethod,
        relativePath,
        pathSource,
        handlerName,
        params,
        query,
        headers,
        body,
        response,
        live
    };
```

**5d.** Acrescente a função de leitura, ao lado das outras helpers de decorator:

```ts
const LIVE_SHARED = new Set(['private', 'tenant', 'public']);

/**
 * Read @Live({ shared, key }) off a handler.
 *
 * Only string literals are read. A computed value cannot be resolved at build
 * time, and guessing one would put a wrong `shared` in the bundle — which is
 * the field that decides whether two users may share a computed instance.
 */
function readLive(method: ts.MethodDeclaration, checker: ts.TypeChecker): RouteLive | undefined {
    const decorator = findDecorator(method, 'Live');

    if (!decorator) {
        return undefined;
    }

    const live: RouteLive = { shared: 'private' };
    const arg = firstDecoratorArg(decorator);

    if (!arg || !ts.isObjectLiteralExpression(arg)) {
        return live;
    }

    const sharedExpr = getObjectProperty(arg, 'shared');

    if (sharedExpr) {
        const resolved = resolveStringLiteral(sharedExpr, checker);

        if (resolved.value && LIVE_SHARED.has(resolved.value)) {
            live.shared = resolved.value as RouteLive['shared'];
        }
    }

    const keyExpr = getObjectProperty(arg, 'key');

    if (keyExpr) {
        const resolved = resolveStringLiteral(keyExpr, checker);

        if (resolved.value) {
            live.key = resolved.value;
        }
    }

    return live;
}
```

**5e.** Em `flattenController`, carregue o campo para o `RouteSchema`:

```ts
        routes.push({
            method: route.method,
            path: fullPath,
            relativePath: route.relativePath,
            pathSource: route.pathSource ?? controller.pathSource,
            handlerName: route.handlerName,
            controllerName: controller.name,
            filePath: controller.filePath,
            params,
            query: route.query,
            headers: route.headers,
            body: route.body,
            response: route.response,
            live: route.live
        });
```

- [ ] **Step 6: Emit the descriptors**

Em `packages/client/src/codegen/emit.ts`:

**6a.** Acrescente as constantes de texto abaixo dos imports:

```ts
const HTTP_METHOD_TYPE =
    `export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';`;

const DESCRIPTOR_TYPES = [
    `export type LiveShared = 'private' | 'tenant' | 'public';`,
    '',
    'export interface RouteDescriptor<R = unknown> {',
    '  readonly method: HttpMethod;',
    '  readonly path: string;',
    '  /** Only on @Live() routes: the id the subscription protocol addresses. */',
    '  readonly resourceId?: string;',
    '  readonly live?: { readonly shared: LiveShared; readonly key?: string };',
    "  /** Phantom: carries the route's types. Never present at runtime. */",
    '  readonly __route?: R;',
    '}'
].join('\n');
```

**6b.** Em `emitApp`, acrescente os três blocos depois de `pathConsts`:

```ts
export function emitApp(routes: RouteSchema[], aliases: TypeAlias[] = []): string {
    const tree = buildTree(routes);
    const appType = emitNode(tree, 1);
    const pathConsts = emitPaths(routes);

    const lines = [
        '// Generated by @carno.js/client. Do not edit.',
        '// This file is overwritten automatically when the Carno app starts or the Vite/Bun plugin runs.',
        ''
    ];

    for (const alias of aliases) {
        lines.push(`export type ${alias.name} = ${alias.type};`);
    }

    if (aliases.length) {
        lines.push('');
    }

    lines.push(`export type App = ${appType};`);
    lines.push('');
    lines.push(pathConsts);
    lines.push('');
    lines.push(HTTP_METHOD_TYPE);
    lines.push('');
    lines.push(DESCRIPTOR_TYPES);
    lines.push('');
    lines.push(emitRoutes(routes));
    lines.push('');

    return lines.join('\n');
}
```

**6c.** Extraia o agrupamento que o `emitPaths` já fazia, para os dois consumirem o mesmo, e acrescente o emissor de descriptors. Substitua `emitPaths` e acrescente as três funções:

```ts
/** Group routes the way both `paths` and `routes` expose them. */
function groupRoutes(routes: RouteSchema[]): Map<string, Map<string, RouteSchema>> {
    const grouped = new Map<string, Map<string, RouteSchema>>();

    for (const route of routes) {
        const group = pathGroup(route);
        if (!grouped.has(group)) {
            grouped.set(group, new Map());
        }

        const bucket = grouped.get(group)!;
        let key = route.handlerName;
        if (bucket.has(key) && bucket.get(key)!.path !== route.path) {
            key = `${route.handlerName}_${route.method}`;
        }
        bucket.set(key, route);
    }

    return grouped;
}

function emitPaths(routes: RouteSchema[]): string {
    const grouped = groupRoutes(routes);
    const groups = [...grouped.keys()].sort();

    if (!groups.length) {
        return 'export const paths = {} as const;';
    }

    const lines = ['export const paths = {'];
    for (const group of groups) {
        const entries = [...grouped.get(group)!.entries()].sort(([a], [b]) => a.localeCompare(b));
        lines.push(`  ${quoteProp(group)}: {`);
        for (const [name, route] of entries) {
            lines.push(`    ${quoteProp(name)}: ${JSON.stringify(route.path)},`);
        }
        lines.push('  },');
    }
    lines.push('} as const;');
    return lines.join('\n');
}

function emitRoutes(routes: RouteSchema[]): string {
    const grouped = groupRoutes(routes);
    const groups = [...grouped.keys()].sort();

    if (!groups.length) {
        return 'export const routes = {} as const;';
    }

    const lines = ['export const routes = {'];
    for (const group of groups) {
        const entries = [...grouped.get(group)!.entries()].sort(([a], [b]) => a.localeCompare(b));
        lines.push(`  ${quoteProp(group)}: {`);
        for (const [name, route] of entries) {
            lines.push(`    ${quoteProp(name)}: ${descriptorLiteral(route)},`);
        }
        lines.push('  },');
    }
    lines.push('} as const;');
    return lines.join('\n');
}

function descriptorLiteral(route: RouteSchema): string {
    const fields = [
        `method: ${JSON.stringify(route.method)}`,
        `path: ${JSON.stringify(route.path)}`
    ];

    if (route.live) {
        // Only subscribable routes carry the controller name, because only they
        // are addressed by it over the wire.
        fields.push(`resourceId: ${JSON.stringify(`${route.controllerName}.${route.handlerName}`)}`);

        const live = [`shared: ${JSON.stringify(route.live.shared)}`];

        if (route.live.key) {
            live.push(`key: ${JSON.stringify(route.live.key)}`);
        }

        fields.push(`live: { ${live.join(', ')} }`);
    }

    return `{ ${fields.join(', ')} } as RouteDescriptor<${typeAccessor(route)}>`;
}

/** `/cards/:id` + get becomes `App["cards"][":id"]["get"]`. */
function typeAccessor(route: RouteSchema): string {
    const segments = splitPathSegments(route.path)
        .map((segment) => `[${JSON.stringify(segment)}]`)
        .join('');

    return `App${segments}[${JSON.stringify(route.method)}]`;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test packages/client/test/live-codegen.spec.ts`
Expected: PASS, 7 testes.

- [ ] **Step 8: Run the whole client suite**

Run: `bun test packages/client`
Expected: PASS. `generate.spec.ts` afirma que o conteúdo gerado não contém `UserController`; como o fixture antigo não tem nenhuma rota `@Live()`, nenhum `resourceId` é emitido lá e a afirmação continua verdadeira.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/codegen packages/client/test/live-codegen.spec.ts packages/client/test/helpers.ts packages/client/test/fixtures/live-app
git commit -m "feat(client): read @Live() in the scanner and emit typed route descriptors

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: As regras da §5.6 aparecem no build, não só no boot

O `ResourceRegistry` já recusa um resource mal declarado no startup. O problema é que o startup acontece depois de você ter escrito o código, rodado o codegen e escrito a tela. A §7 é explícita: "mesma regra, dois momentos". O scanner já tem `ScanWarning` com arquivo e linha; falta usar.

Duas regras não conseguem apontar a linha, porque só se decidem depois que todas as rotas foram achatadas: a colisão de `resourceId` e o `key` faltando numa coleção. Elas apontam o arquivo. As três que se decidem lendo o handler apontam a linha.

**Files:**
- Create: `packages/client/test/fixtures/live-app/src/bad.controller.ts`
- Create: `packages/client/test/fixtures/live-app/src/mirror.controller.ts`
- Modify: `packages/client/src/codegen/scan.ts`
- Test: `packages/client/test/live-warnings.spec.ts` (criar)

**Interfaces:**
- Consumes: `ScanWarning` (`codegen/types.ts`), `locate()`, `getNodeDecorators()`, `decoratorName()` (já em `scan.ts`), `collectAliases` (`codegen/serialize-type.ts`).
- Produces: nenhuma API nova; `ScanResult.warnings` ganha cinco famílias de aviso.

- [ ] **Step 1: Extend the fixture with the bad cases**

`packages/client/test/fixtures/live-app/src/bad.controller.ts`:

```ts
import { Controller, Ctx, Get, Header, Put, Query, Req } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card } from './dto';

@Controller('/bad')
export class BadController {
    @Put('/:id')
    @Live()
    replace(): Card {
        return { id: '1', title: '', done: false };
    }

    @Get('/request')
    @Live()
    withRequest(@Req() req: unknown, @Ctx() ctx: unknown): Card[] {
        void req;
        void ctx;
        return [];
    }

    @Get('/header')
    @Live()
    withHeader(@Header('x-tenant') tenant: string): Card[] {
        void tenant;
        return [];
    }

    @Get('/unserializable')
    @Live()
    withDate(@Query('since') since: Date): Card[] {
        void since;
        return [];
    }

    @Get('/needs-key')
    @Live()
    needsKey(): Card[] {
        return [];
    }
}
```

`packages/client/test/fixtures/live-app/src/mirror.controller.ts` — uma segunda classe com o mesmo nome de outra, o que é legal em TypeScript e produz dois resources com o mesmo id:

```ts
import { Controller, Get } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card } from './dto';

@Controller('/mirror')
export class BoardController {
    @Get()
    @Live({ key: 'id' })
    list(): Card[] {
        return [];
    }
}
```

- [ ] **Step 2: Write the failing test**

Crie `packages/client/test/live-warnings.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveClientOptions } from '../src/codegen/options';
import { scanProject } from '../src/codegen/scan';
import { liveFixtureRoot } from './helpers';

function warnings() {
    return scanProject(resolveClientOptions({
        root: liveFixtureRoot,
        include: ['src/**/*.ts'],
        output: 'src/generated/app.ts',
        silent: true,
        nodeEnv: 'development',
        force: true
    })).warnings;
}

function find(fragment: string) {
    return warnings().find(warning => warning.message.includes(fragment));
}

describe('live validation at build time', () => {
    test('warns about @Live() on a verb that is neither GET nor POST', () => {
        const warning = find('@Live() on @PUT()');

        expect(warning).toBeDefined();
        expect(warning!.file).toContain('bad.controller.ts');
        expect(warning!.line).toBeGreaterThan(0);
    });

    test('warns about request-bound parameters, one per parameter', () => {
        expect(find('@Req()')).toBeDefined();
        expect(find('@Ctx()')).toBeDefined();
        expect(find('@Header()')).toBeDefined();
    });

    test('warns about an input type that cannot be hashed', () => {
        const warning = find('cannot be canonicalized');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('since');
    });

    test('warns about a keyed collection with no key declared', () => {
        const warning = find('declares no `key`');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('needsKey');
    });

    test('warns about two live resources sharing one id', () => {
        const warning = find('share the id');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('BoardController.list');
    });

    test('says nothing about a well-formed live resource', () => {
        const noise = warnings().filter(warning => warning.message.includes('BoardController.byId'));

        expect(noise).toEqual([]);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/client/test/live-warnings.spec.ts`
Expected: FAIL — nenhum dos avisos existe.

- [ ] **Step 4: Add the handler-level rules**

Em `packages/client/src/codegen/scan.ts`:

**4a.** Acrescente duas constantes ao lado de `PARAM_DECORATORS`:

```ts
/** Parameters a live resource may not take: none of them survive a recompute. */
const LIVE_FORBIDDEN_PARAMS = new Set(['Req', 'Ctx', 'Header', 'Locals']);

/**
 * Shapes with no agreed wire form, which the runtime canonicalizer refuses.
 *
 * The check is shallow on purpose: it reads the serialized type of the slot, so
 * it catches `since: Date` and misses a `Date` buried inside a named DTO. The
 * runtime still throws NonSerializableInputError for those; this is the early
 * warning, not the guarantee.
 */
const NON_SERIALIZABLE_INPUT = /(^|\W)(Date|File|Blob|FormData|RegExp)(\W|$)|\b(Map|Set)</;
```

**4b.** Em `readRoute`, depois de `const live = readLive(method, checker);`, acrescente a checagem das três regras:

```ts
    if (live) {
        checkLiveHandler(method, httpMethod, handlerName, live, [...params, ...query, ...body], sourceFile, warnings);
    }
```

Repare que `headers` fica de fora da lista de slots: um `@Header()` num live resource já é recusado pela regra anterior, e avisar duas vezes sobre a mesma linha só faz barulho.

**4c.** Acrescente as funções, junto das outras helpers:

```ts
function checkLiveHandler(
    method: ts.MethodDeclaration,
    httpMethod: HttpMethod,
    handlerName: string,
    live: RouteLive,
    slots: RouteSlot[],
    sourceFile: ts.SourceFile,
    warnings: ScanWarning[]
): void {
    void live;

    if (httpMethod !== 'get' && httpMethod !== 'post') {
        warnings.push(locate(
            `${handlerName} carries @Live() on @${httpMethod.toUpperCase()}(). Subscribing re-runs the ` +
            `handler whenever the data changes, so it has to be idempotent: only @Get() and @Post() may be live.`,
            sourceFile,
            method
        ));
    }

    for (const parameter of method.parameters) {
        for (const decorator of getNodeDecorators(parameter)) {
            const name = decoratorName(decorator);

            if (name && LIVE_FORBIDDEN_PARAMS.has(name)) {
                warnings.push(locate(
                    `${handlerName} is a live resource and takes @${name}(). There is no request, no header ` +
                    `set and no middleware locals during a recompute; a live resource has to be a pure ` +
                    `function of its declared inputs.`,
                    sourceFile,
                    parameter
                ));
            }
        }
    }

    for (const slot of slots) {
        if (!NON_SERIALIZABLE_INPUT.test(slot.type)) {
            continue;
        }

        warnings.push(locate(
            `${handlerName} takes \`${slot.name ?? 'an input'}: ${slot.type}\`, which cannot be canonicalized ` +
            `into an instance key. Live inputs must be JSON: strings, numbers, booleans, arrays and plain objects.`,
            sourceFile,
            method
        ));
    }
}
```

- [ ] **Step 5: Add the two whole-program rules**

Em `packages/client/src/codegen/scan.ts`, dentro de `scanProject`, depois do `routes.sort(...)` e antes do `return`:

```ts
    const aliases = collectAliases(ctx);

    warnDuplicateResourceIds(routes, warnings);
    warnMissingCollectionKey(routes, aliases, warnings);

    return { routes, warnings, aliases };
```

E acrescente as funções ao fim do arquivo:

```ts
/**
 * The subscription protocol addresses a resource by `Controller.handler`. Two
 * classes with the same name in different files produce the same id, and one
 * of them silently shadows the other at startup.
 */
function warnDuplicateResourceIds(routes: RouteSchema[], warnings: ScanWarning[]): void {
    const seen = new Map<string, RouteSchema>();

    for (const route of routes) {
        if (!route.live) {
            continue;
        }

        const id = `${route.controllerName}.${route.handlerName}`;
        const previous = seen.get(id);

        if (previous) {
            warnings.push({
                message:
                    `Two live resources share the id \`${id}\`: ` +
                    `${previous.method.toUpperCase()} ${previous.path} and ` +
                    `${route.method.toUpperCase()} ${route.path}. Rename one of the controllers.`,
                file: route.filePath
            });
            continue;
        }

        seen.set(id, route);
    }
}

/** The array element type, or null when the response is not a collection. */
function arrayElementType(response: string): string | null {
    const trimmed = response.trim();

    if (trimmed.endsWith('[]')) {
        const inner = trimmed.slice(0, -2).trim();
        return inner.startsWith('(') && inner.endsWith(')') ? inner.slice(1, -1).trim() : inner;
    }

    const generic = /^Array<(.+)>$/.exec(trimmed);
    return generic ? generic[1].trim() : null;
}

/**
 * §4.6: without a key, an array diff is positional. Inserting at the top
 * rebuilds the whole list, the user loses input focus and animations restart.
 */
function warnMissingCollectionKey(
    routes: RouteSchema[],
    aliases: TypeAlias[],
    warnings: ScanWarning[]
): void {
    const byName = new Map(aliases.map((alias) => [alias.name, alias.type]));

    for (const route of routes) {
        if (!route.live || route.live.key) {
            continue;
        }

        const element = arrayElementType(route.response);

        if (!element) {
            continue;
        }

        const resolved = byName.get(element) ?? element;

        if (!/(^|[{;]\s*)id\??\s*:/.test(resolved)) {
            continue;
        }

        warnings.push({
            message:
                `${route.controllerName}.${route.handlerName} returns rows with an \`id\`, but its @Live() ` +
                `declares no \`key\`. Patches would be positional: inserting at the top rebuilds the whole ` +
                `list, so the user loses input focus and animations restart. Declare @Live({ key: 'id' }).`,
            file: route.filePath
        });
    }
}
```

Acrescente `RouteLive` e `TypeAlias` ao import de tipos, se ainda não estiverem lá:

```ts
import type {
    HttpMethod,
    RouteLive,
    RouteSchema,
    RouteSlot,
    ScanResult,
    ScanWarning,
    TypeAlias
} from './types';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/client/test/live-warnings.spec.ts`
Expected: PASS, 6 testes.

- [ ] **Step 7: Run the whole client suite**

Run: `bun test packages/client`
Expected: PASS. Os testes da Task 7 usam o mesmo fixture e continuam achando as rotas por caminho; as rotas novas não colidem com nenhuma delas.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/codegen/scan.ts packages/client/test/live-warnings.spec.ts packages/client/test/fixtures/live-app
git commit -m "feat(client): surface the live resource rules as build-time warnings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: `createApi()` — o descriptor vira chamável

Um descriptor que só carrega dados obriga quem usa a manter duas árvores: `routes.cards.list` para assinar, `client.cards.get()` para chamar. A §7 quer uma só. `createApi()` percorre a árvore emitida e troca cada folha por uma função que carrega os próprios campos do descriptor — chamável para HTTP, legível para o `useLive`.

Uma diferença em relação ao exemplo da §7: o input é `{ params, query, body }`, não um objeto plano. Um objeto plano não consegue distinguir `/cards/:id` de `?id=`, e a forma estruturada é a mesma que o `LiveInputs` já usa dos dois lados do fio.

**Files:**
- Modify: `packages/client/src/client/http.ts`
- Modify: `packages/client/src/client/types.ts`
- Create: `packages/client/src/client/descriptor.ts`
- Modify: `packages/client/src/client/index.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/test/descriptor.spec.ts` (criar)

**Interfaces:**
- Consumes: `executeRequest`, `stripTrailingSlashes` (`client/http.ts`, exportados nesta task); `ClientConfig`, `ClientResult`, `RouteOptions`, `RouteResponse` (`client/types.ts`).
- Produces:
  - `interface RouteDescriptor<R>` (gêmeo estrutural do emitido pelo codegen)
  - `type RouteInput<R>`, `type ApiCall<R>`, `type ApiOf<T>`
  - `createApi<T>(routes: T, config: ClientConfig & { baseUrl: string }): ApiOf<T>`
  - `fillPath(template, params): string`

- [ ] **Step 1: Write the failing test**

Crie `packages/client/test/descriptor.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createApi, fillPath } from '../src/client/descriptor';
import type { RouteDescriptor } from '../src/client/descriptor';

interface Card {
    id: string;
    title: string;
}

const routes = {
    cards: {
        list: { method: 'get', path: '/cards', resourceId: 'BoardController.list', live: { shared: 'tenant', key: 'id' } } as RouteDescriptor<{ query: { status?: string }; response: Card[] }>,
        byId: { method: 'get', path: '/cards/:id', resourceId: 'BoardController.byId', live: { shared: 'private' } } as RouteDescriptor<{ params: { id: string }; response: Card }>,
        create: { method: 'post', path: '/cards' } as RouteDescriptor<{ body: { title: string }; response: Card }>
    }
} as const;

function recorder(payload: unknown = [{ id: '1', title: 'Ada' }]) {
    const calls: { url: string; method?: string; body?: unknown }[] = [];

    const fetcher = (async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method, body: init?.body });
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    }) as typeof fetch;

    return { calls, fetcher };
}

describe('fillPath', () => {
    test('substitutes and encodes path parameters', () => {
        expect(fillPath('/cards/:id/notes', { id: 'a b' })).toBe('/cards/a%20b/notes');
    });

    test('refuses to build a URL with a hole in it', () => {
        expect(() => fillPath('/cards/:id', {})).toThrow(/Missing path parameter "id"/);
    });

    test('leaves a static path alone', () => {
        expect(fillPath('/cards')).toBe('/cards');
    });
});

describe('createApi', () => {
    test('calls the route and returns the parsed body', async () => {
        const { calls, fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        const result = await api.cards.list({ query: { status: 'open' } });

        expect(calls[0].url).toBe('http://api.test/cards?status=open');
        expect(calls[0].method).toBe('GET');
        expect(result.data).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('fills path parameters', async () => {
        const { calls, fetcher } = recorder({ id: '7', title: 'Ada' });
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        await api.cards.byId({ params: { id: '7' } });

        expect(calls[0].url).toBe('http://api.test/cards/7');
    });

    test('sends a JSON body on a POST', async () => {
        const { calls, fetcher } = recorder({ id: '2', title: 'New' });
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        await api.cards.create({ body: { title: 'New' } });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].body).toBe(JSON.stringify({ title: 'New' }));
    });

    test('the callable still carries the descriptor fields', () => {
        const { fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        expect(api.cards.list.resourceId).toBe('BoardController.list');
        expect(api.cards.list.live).toEqual({ shared: 'tenant', key: 'id' });
        expect(api.cards.create.resourceId).toBeUndefined();
    });

    test('keeps the shape of the tree', () => {
        const { fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        expect(typeof api.cards).toBe('object');
        expect(typeof api.cards.list).toBe('function');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/test/descriptor.spec.ts`
Expected: FAIL — `Cannot find module '../src/client/descriptor'`.

- [ ] **Step 3: Open the request path for reuse**

Em `packages/client/src/client/http.ts`, três edições.

**3a.** Acrescente e exporte o tipo das opções, logo abaixo dos imports:

```ts
export interface RequestOptions {
    query?: Record<string, unknown>;
    headers?: Record<string, string | undefined>;
    fetch?: RequestInit;
}
```

**3b.** Renomeie `execute` para `executeRequest`, exporte-a, e troque os dois parâmetros posicionais ambíguos por `body` e `options` explícitos. Só a assinatura e as quatro primeiras linhas mudam; o corpo a partir de `const request = createRequestUrl(...)` fica idêntico:

```ts
/** The one request path, shared by the path proxy and by createApi(). */
export async function executeRequest(
    origin: string,
    pathname: string,
    method: HttpMethod,
    body: unknown,
    options: RequestOptions | undefined,
    config: ClientConfig
): Promise<ClientResult<unknown>> {
    const request = createRequestUrl(origin, pathname);

    if (options?.query) {
```

**3c.** No `createProxy`, faça a desambiguação de `first`/`second` no ponto da chamada, que é onde ela sempre pertenceu:

```ts
            if (HTTP_METHODS.has(key)) {
                return (first?: unknown, second?: unknown) => {
                    const method = key as HttpMethod;
                    const hasBody = BODY_METHODS.has(method);

                    return executeRequest(
                        origin,
                        currentPath || '/',
                        method,
                        hasBody ? first : undefined,
                        (hasBody ? second : first) as RequestOptions | undefined,
                        config
                    );
                };
            }
```

**3d.** Exporte o utilitário de origem, que o `createApi` também precisa:

```ts
export function stripTrailingSlashes(value: string): string {
```

- [ ] **Step 4: Export the response type**

Em `packages/client/src/client/types.ts`, exporte o alias que já existe:

```ts
export type RouteResponse<R> = R extends { response: infer S } ? NormalizeClientData<S> : unknown;
```

- [ ] **Step 5: Write the descriptor client**

Crie `packages/client/src/client/descriptor.ts`:

```ts
import { executeRequest, stripTrailingSlashes, type RequestOptions } from './http';
import type { ClientConfig, ClientResult, HttpMethod, RouteOptions, RouteResponse } from './types';

/**
 * The runtime shape the codegen emits for every route.
 *
 * Declared here as well, structurally identical: the generated file is
 * standalone by design — it imports nothing — so the two definitions meet
 * through TypeScript's structural typing rather than through an import.
 */
export interface RouteDescriptor<R = unknown> {
    readonly method: HttpMethod;
    readonly path: string;
    /** Only on @Live() routes: the id the subscription protocol addresses. */
    readonly resourceId?: string;
    readonly live?: { readonly shared: 'private' | 'tenant' | 'public'; readonly key?: string };
    /** Phantom: carries the route's types. Never present at runtime. */
    readonly __route?: R;
}

export type RouteInput<R> =
    (R extends { params: infer P } ? { params: P } : { params?: never })
    & (R extends { query: infer Q } ? { query: Q } : { query?: never })
    & (R extends { body: infer B } ? { body: B } : { body?: never });

export type ApiCall<R> = (
    input?: RouteInput<R>,
    options?: RouteOptions<R>
) => Promise<ClientResult<RouteResponse<R>>>;

export type ApiOf<T> = {
    [K in keyof T]: T[K] extends RouteDescriptor<infer R> ? ApiCall<R> & T[K] : ApiOf<T[K]>;
};

/** Substitute `:name` segments, refusing to build a URL with a hole in it. */
export function fillPath(template: string, params?: Record<string, unknown>): string {
    return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
        const value = params?.[name];

        if (value === undefined || value === null) {
            throw new Error(`Missing path parameter "${name}" for ${template}.`);
        }

        return encodeURIComponent(String(value));
    });
}

/**
 * Turn the generated `routes` tree into callables.
 *
 * Additive on purpose: `client<App>(baseUrl)` keeps working exactly as before.
 * This is the surface the live client reads `resourceId` and `live` from.
 */
export function createApi<T>(routes: T, config: ClientConfig & { baseUrl: string }): ApiOf<T> {
    const origin = stripTrailingSlashes(config.baseUrl);
    return buildNode(routes, origin, config) as ApiOf<T>;
}

function buildNode(node: unknown, origin: string, config: ClientConfig): unknown {
    if (isDescriptor(node)) {
        return buildCallable(node, origin, config);
    }

    if (!node || typeof node !== 'object') {
        return node;
    }

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = buildNode(value, origin, config);
    }

    return out;
}

function isDescriptor(value: unknown): value is RouteDescriptor {
    return Boolean(value)
        && typeof value === 'object'
        && typeof (value as RouteDescriptor).method === 'string'
        && typeof (value as RouteDescriptor).path === 'string';
}

interface CallInput {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
}

function buildCallable(descriptor: RouteDescriptor, origin: string, config: ClientConfig): unknown {
    const call = (input?: CallInput, options?: RouteOptions<unknown>) => {
        const extra = options as { headers?: Record<string, string | undefined>; fetch?: RequestInit } | undefined;
        const request: RequestOptions = {
            query: input?.query,
            headers: extra?.headers,
            fetch: extra?.fetch
        };

        return executeRequest(
            origin,
            fillPath(descriptor.path, input?.params),
            descriptor.method,
            input?.body,
            request,
            config
        );
    };

    // The descriptor's own fields ride along, so `api.cards.list` is both the
    // call and the thing `useLive` reads.
    return Object.assign(call, descriptor);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/client/test/descriptor.spec.ts`
Expected: PASS, 8 testes.

- [ ] **Step 7: Export it**

Em `packages/client/src/client/index.ts`:

```ts
export { client } from './http';
export { createApi, fillPath } from './descriptor';
export type { ApiCall, ApiOf, RouteDescriptor, RouteInput } from './descriptor';
export type {
    HttpMethod,
    RouteOptions,
    RouteResponse,
    HttpClient,
    ClientConfig,
    ClientCreate,
    ClientErrorValue,
    ClientHeaders,
    ClientResult
} from './types';
```

Em `packages/client/src/index.ts`:

```ts
export { client } from './client/http';
export { createApi, fillPath } from './client/descriptor';
export type { ApiCall, ApiOf, RouteDescriptor, RouteInput } from './client/descriptor';
export type {
    HttpMethod,
    RouteOptions,
    RouteResponse,
    HttpClient,
    ClientConfig,
    ClientCreate,
    ClientErrorValue,
    ClientHeaders,
    ClientResult
} from './client/types';
```

- [ ] **Step 8: Run the whole client suite**

Run: `bun test packages/client`
Expected: PASS. `http.spec.ts` exercita o proxy antigo e prova que a extração do `executeRequest` não mudou comportamento.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/client packages/client/src/index.ts packages/client/test/descriptor.spec.ts
git commit -m "feat(client): make route descriptors callable with createApi()

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: `useLive(descriptor)` — a subscrição tipada

`useLive('UsersController.list', { query: { status } })` funciona e não tem tipo nenhum: a string não diz o que volta, e um erro de digitação vira um `error: unknown_resource` em produção. Com o descriptor, o resource, os inputs e a resposta vêm todos do mesmo lugar.

**Files:**
- Create: `packages/live/src/shared/descriptor.ts`
- Modify: `packages/live/src/client/react.ts`
- Modify: `packages/live/src/index.ts`
- Test: `packages/live/test/use-live.test.ts` (criar)

**Interfaces:**
- Consumes: `LiveClient`, `LiveState`, `storeKey` (`src/client/core.ts`); `LiveInputs` (`src/shared/inputs.ts`).
- Produces:
  - `interface LiveDescriptor<R>`, `type LiveDataOf<R>`, `type LiveInputsOf<R>`, `resourceIdOf(descriptor)`, `normalizeLiveInputs(inputs)`
  - `useLive` com duas sobrecargas: string (como na Fase 1) e descriptor.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/use-live.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDescriptor
} from '../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

const listDescriptor = {
    method: 'get',
    path: '/cards',
    resourceId: 'BoardController.list',
    live: { shared: 'tenant', key: 'id' }
} as LiveDescriptor<{ query: { status?: string }; response: Card[] }>;

const plainDescriptor = {
    method: 'post',
    path: '/cards'
} as LiveDescriptor<{ body: { title: string }; response: Card }>;

class SilentSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send(): void {}
    close(): void {}
}

describe('resourceIdOf', () => {
    test('returns the id of a live route', () => {
        expect(resourceIdOf(listDescriptor)).toBe('BoardController.list');
    });

    test('explains itself when the route is not live', () => {
        expect(() => resourceIdOf(plainDescriptor)).toThrow(/not a live resource/);
    });
});

describe('normalizeLiveInputs', () => {
    test('fills the three slots', () => {
        expect(normalizeLiveInputs({ query: { status: 'open' } })).toEqual({
            params: {},
            query: { status: 'open' },
            body: undefined
        });
    });

    test('accepts nothing at all', () => {
        expect(normalizeLiveInputs()).toEqual({ params: {}, query: {}, body: undefined });
    });
});

describe('useLive with a descriptor', () => {
    test('reads the hydrated store for that resource and inputs', () => {
        const inputs = { params: {}, query: { status: 'open' }, body: undefined };
        const client = new LiveClient({
            url: 'ws://test/live',
            socketFactory: () => new SilentSocket(),
            hydrate: {
                [storeKey('BoardController.list', inputs)]: {
                    data: [{ id: '1', title: 'Ada' }],
                    hash: 'h1'
                }
            }
        });

        function Board() {
            const state = useLive(listDescriptor, { query: { status: 'open' } });
            return createElement('div', null, JSON.stringify(state.data ?? null));
        }

        const html = renderToStaticMarkup(
            createElement(LiveProvider, { client }, createElement(Board))
        );

        expect(html).toContain('Ada');
    });

    test('the string form from phase 1 still works', () => {
        const inputs = { params: {}, query: {}, body: undefined };
        const client = new LiveClient({
            url: 'ws://test/live',
            socketFactory: () => new SilentSocket(),
            hydrate: {
                [storeKey('BoardController.list', inputs)]: { data: [{ id: '9' }], hash: 'h9' }
            }
        });

        function Board() {
            const state = useLive<{ id: string }[]>('BoardController.list');
            return createElement('div', null, JSON.stringify(state.data ?? null));
        }

        const html = renderToStaticMarkup(
            createElement(LiveProvider, { client }, createElement(Board))
        );

        expect(html).toContain('&quot;9&quot;');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/use-live.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/descriptor'`.

- [ ] **Step 3: Write the descriptor module**

Crie `packages/live/src/shared/descriptor.ts`:

```ts
import type { LiveInputs } from './inputs';

/**
 * Structural twin of the descriptor @carno.js/client emits.
 *
 * The generated file imports nothing, on purpose, so the two definitions meet
 * through TypeScript's structural typing. Keep the field names identical.
 */
export interface LiveDescriptor<R = unknown> {
    readonly method: string;
    readonly path: string;
    readonly resourceId?: string;
    readonly live?: { readonly shared: 'private' | 'tenant' | 'public'; readonly key?: string };
    readonly __route?: R;
}

/** What the route answers, as the client sees it. */
export type LiveDataOf<R> = R extends { response: infer S } ? Exclude<S, undefined | void> : unknown;

/** What the route takes, as a subscription sends it. */
export type LiveInputsOf<R> =
    (R extends { params: infer P } ? { params: P } : { params?: Record<string, string> })
    & (R extends { query: infer Q } ? { query: Q } : { query?: Record<string, string | string[]> })
    & (R extends { body: infer B } ? { body: B } : { body?: undefined });

export function resourceIdOf(descriptor: LiveDescriptor<any>): string {
    if (!descriptor.resourceId || !descriptor.live) {
        throw new Error(
            `${descriptor.method.toUpperCase()} ${descriptor.path} is not a live resource. ` +
            `Add @Live() to the handler and re-run the client codegen.`
        );
    }

    return descriptor.resourceId;
}

/** Fill the three input slots, whichever of them the caller bothered with. */
export function normalizeLiveInputs(inputs: Partial<LiveInputs> = {}): LiveInputs {
    return {
        params: inputs.params ?? {},
        query: inputs.query ?? {},
        body: inputs.body
    };
}
```

- [ ] **Step 4: Overload the hook**

Substitua `useLive` em `packages/live/src/client/react.ts` e ajuste os imports:

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
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDataOf,
    type LiveDescriptor,
    type LiveInputsOf
} from '../shared/descriptor';
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState } from './core';
```

```ts
export function useLive<T>(resource: string, inputs?: Partial<LiveInputs>): LiveState<T>;
export function useLive<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: LiveInputsOf<R>
): LiveState<LiveDataOf<R>>;

/**
 * Subscribe a component to server-owned state.
 *
 * The component keeps its own local state next to this — selected row, open
 * modal, focused input. None of that travels; only the server's data does.
 */
export function useLive(
    resource: string | LiveDescriptor<any>,
    inputs: Partial<LiveInputs> = {}
): LiveState<any> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLive() requires a <LiveProvider client={...}> above it in the tree.');
    }

    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);
    const normalized = normalizeLiveInputs(inputs);
    const identity = canonical({
        params: normalized.params,
        query: normalized.query,
        body: normalized.body ?? null
    });

    // Depend on the canonical form, not on the object: a new literal every
    // render would resubscribe on every render.
    const stable = useMemo(() => normalized, [identity]);
    const store = useMemo(() => client.store(resourceId, stable), [client, resourceId, stable]);

    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/live/test/use-live.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 6: Export it**

Em `packages/live/src/index.ts`, junto do bloco de protocolo:

```ts
export { normalizeLiveInputs, resourceIdOf } from './shared/descriptor';
export type { LiveDataOf, LiveDescriptor, LiveInputsOf } from './shared/descriptor';
```

- [ ] **Step 7: Run the whole live suite and commit**

Run: `bun test packages/live`
Expected: PASS.

```bash
git add packages/live/src/shared/descriptor.ts packages/live/src/client/react.ts packages/live/src/index.ts packages/live/test/use-live.test.ts
git commit -m "feat(live): subscribe through a typed route descriptor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: O overlay otimista dentro do `LiveClient`

A §6.3 é específica sobre o porquê: o patch otimista vive numa camada **acima** do snapshot confirmado, nunca dentro dele. Se o otimismo mutasse o snapshot, um patch do servidor chegando com a ação em voo se aplicaria a um estado que o servidor não conhece, e a UI piscaria. Com a camada separada, o patch se aplica ao confirmado e o overlay é reprojetado por cima.

**Files:**
- Modify: `packages/live/src/client/core.ts`
- Test: `packages/live/test/optimistic.test.ts` (criar)

**Interfaces:**
- Consumes: `PatchEngine` (`src/patch/PatchEngine.ts`).
- Produces: `LiveClient.overlay(resourceId: string, apply: (draft: any) => void): () => void`.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/optimistic.test.ts`:

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

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {}

    open(): void {
        this.onopen?.();
    }

    deliver(message: ServerMessage): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }

    sid(): string {
        const sub = this.sent.find(message => message.t === 'sub') as { sid: string };
        return sub.sid;
    }
}

function build() {
    const socket = new FakeSocket();
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => socket,
        unsubGraceMs: 5
    });

    const store = client.store<{ id: number; title: string }[]>('Cards.list', { params: {}, query: {} });
    store.subscribe(() => {});
    socket.open();
    socket.deliver({
        t: 'snapshot',
        sid: socket.sid(),
        rev: 1,
        hash: 'h1',
        data: [{ id: 1, title: 'Ada' }],
        key: 'id'
    });

    return { client, socket, store };
}

describe('optimistic overlay', () => {
    test('shows the optimistic row before the server knows about it', () => {
        const { client, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: -1, title: 'pending' }
        ]);
    });

    test('removing the overlay goes back to what the server confirmed', () => {
        const { client, store } = build();

        const remove = client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });
        remove();

        expect(store.getSnapshot().data).toEqual([{ id: 1, title: 'Ada' }]);
    });

    test('a server patch during the action applies underneath the overlay', () => {
        const { client, socket, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        socket.deliver({
            t: 'patch',
            sid: socket.sid(),
            from: 1,
            to: 2,
            hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, title: 'Linus' } }]
        });

        // The server's row landed on the confirmed snapshot; the optimistic row
        // is still projected on top of it.
        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: 2, title: 'Linus' },
            { id: -1, title: 'pending' }
        ]);
    });

    test('the confirmed snapshot survives the overlay being dropped', () => {
        const { client, socket, store } = build();

        const remove = client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        socket.deliver({
            t: 'patch',
            sid: socket.sid(),
            from: 1,
            to: 2,
            hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, title: 'Linus' } }]
        });
        remove();

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: 2, title: 'Linus' }
        ]);
    });

    test('two overlays apply in the order they were added', () => {
        const { client, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'first' });
        });
        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -2, title: 'second' });
        });

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: -1, title: 'first' },
            { id: -2, title: 'second' }
        ]);
    });

    test('an overlay for another resource leaves this store alone', () => {
        const { client, store } = build();
        const before = store.getSnapshot();

        client.overlay('Cards.other', draft => {
            (draft as unknown[]).push({ id: -1 });
        });

        expect(store.getSnapshot()).toBe(before);
    });

    test('an overlay that throws does not break the store', () => {
        const { client, store } = build();

        client.overlay('Cards.list', () => {
            throw new Error('bad optimistic update');
        });

        expect(store.getSnapshot().data).toEqual([{ id: 1, title: 'Ada' }]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/optimistic.test.ts`
Expected: FAIL — `client.overlay is not a function`.

- [ ] **Step 3: Split confirmed from projected**

Em `packages/live/src/client/core.ts`, cinco edições.

**3a.** Acrescente o campo `confirmed` à interface `Entry`, logo acima de `state`:

```ts
    /** What the server last told us. Patches apply here, never to the projection. */
    confirmed: unknown;
```

**3b.** Acrescente o tipo do overlay e os dois campos da classe, junto de `entries` e `bySid`:

```ts
interface Overlay {
    resource: string;
    apply: (draft: unknown) => void;
}
```

```ts
    private readonly overlays = new Map<number, Overlay>();
    private nextOverlay = 0;
```

**3c.** Em `store()`, inicialize `confirmed` junto do estado:

```ts
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
            confirmed: hydrated?.data,
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
```

**3d.** Acrescente o método público, ao lado de `close()`:

```ts
    /**
     * Show something the server has not confirmed yet.
     *
     * The overlay is a projection over the confirmed snapshot, never a write
     * into it: a patch arriving while the action is in flight lands on the
     * snapshot and the overlay is re-projected on top, so the screen never
     * flickers back to a state the server does not know about.
     *
     * `apply` receives a mutable draft: mutate it, do not return a new value.
     * Returns the function that removes the overlay.
     */
    overlay(resourceId: string, apply: (draft: any) => void): () => void {
        const id = this.nextOverlay++;
        this.overlays.set(id, { resource: resourceId, apply: apply as (draft: unknown) => void });
        this.reproject(resourceId);

        return () => {
            if (this.overlays.delete(id)) {
                this.reproject(resourceId);
            }
        };
    }
```

**3e.** Substitua os três ramos de `onMessage` que escreviam em `data`, e acrescente `project` e `reproject` na seção de internals:

```ts
        switch (message.t) {
            case 'snapshot':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                entry.confirmed = message.data;
                this.project(entry, { pending: false, error: null, stale: false });
                return;

            case 'current':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                // Content already on screen: touch only the flags, keep the
                // data referentially identical so nothing re-renders.
                this.project(entry, { pending: false, error: null, stale: false });
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
                entry.confirmed = entry.patcher.apply(entry.confirmed, message.ops);
                this.project(entry, { pending: false, error: null, stale: false });
                return;

            case 'stale':
                this.update(entry, { ...entry.state, stale: true });
                return;

            case 'error':
                this.update(entry, { ...entry.state, pending: false, error: message.message });
                return;
        }
```

```ts
    /** Confirmed snapshot plus every overlay registered for this resource. */
    private project(
        entry: Entry,
        flags: { pending: boolean; error: string | null; stale: boolean }
    ): void {
        const overlays = [...this.overlays.values()].filter(overlay => overlay.resource === entry.resource);

        if (overlays.length === 0 || entry.confirmed === undefined) {
            this.update(entry, { ...flags, data: entry.confirmed });
            return;
        }

        const draft = structuredClone(entry.confirmed);

        for (const overlay of overlays) {
            try {
                overlay.apply(draft);
            } catch (error) {
                // A broken optimistic update must not take the real data with
                // it: the confirmed snapshot is still correct underneath.
                console.error('[carno:live] an optimistic overlay failed', error);
            }
        }

        this.update(entry, { ...flags, data: draft });
    }

    private reproject(resourceId: string): void {
        for (const entry of this.entries.values()) {
            if (entry.resource !== resourceId) {
                continue;
            }

            this.project(entry, {
                pending: entry.state.pending,
                error: entry.state.error,
                stale: entry.state.stale
            });
        }
    }
```

Nota: o teste "an overlay that throws does not break the store" espera o dado confirmado. Como `project` clona antes de aplicar e o overlay quebrado não chegou a mutar nada, o `draft` clonado é igual ao confirmado — o `update` compara por identidade, vê um objeto novo, e notifica. É uma renderização a mais numa situação que já é um bug da aplicação; não vale código para evitar.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/live/test/optimistic.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Run the whole live suite and commit**

Run: `bun test packages/live`
Expected: PASS.

```bash
git add packages/live/src/client/core.ts packages/live/test/optimistic.test.ts
git commit -m "feat(live): project optimistic overlays above the confirmed snapshot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `useLiveAction` — otimismo com `on`

O alvo é nomeado porque uma ação pode afetar vários resources, ou nenhum que a tela assine. Sem nomear, `draft` só poderia ser `any`. Com `on`, `draft` é `Card[]` e `dto` é `CreateCardDto`, os dois inferidos dos descriptors.

**Files:**
- Create: `packages/live/src/client/optimistic.ts`
- Modify: `packages/live/src/client/react.ts`
- Modify: `packages/live/src/index.ts`
- Create: `packages/live/tsconfig.types.json`
- Test: `packages/live/test/use-live-action.test.ts` (criar)
- Test: `packages/live/test/types/optimistic-types.ts` (criar)

**Interfaces:**
- Consumes: `LiveClient.overlay` (Task 11); `LiveDescriptor`, `LiveDataOf`, `resourceIdOf` (Task 10).
- Produces: `useLiveAction(action, { optimistic })`.

- [ ] **Step 1: Write the failing test**

Crie `packages/live/test/use-live-action.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLiveAction } from '../src/client/react';
import type { LiveDescriptor } from '../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

const listDescriptor = {
    method: 'get',
    path: '/cards',
    resourceId: 'BoardController.list',
    live: { shared: 'public', key: 'id' }
} as LiveDescriptor<{ response: Card[] }>;

class SilentSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send(): void {}
    close(): void {}
}

function clientWithBoard() {
    const inputs = { params: {}, query: {}, body: undefined };
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => new SilentSocket(),
        hydrate: {
            [storeKey('BoardController.list', inputs)]: {
                data: [{ id: '1', title: 'Ada' }],
                hash: 'h1'
            }
        }
    });

    const store = client.store<Card[]>('BoardController.list', inputs);
    store.subscribe(() => {});

    return { client, store };
}

/** Render once so the hook runs, and hand the produced action back out. */
function actionFrom(client: LiveClient, build: () => (dto: any) => Promise<any>) {
    let captured: ((dto: any) => Promise<any>) | null = null;

    function Probe() {
        captured = build();
        return null;
    }

    renderToStaticMarkup(createElement(LiveProvider, { client }, createElement(Probe)));

    return captured!;
}

describe('useLiveAction', () => {
    test('applies the overlay while the action is in flight and drops it after', async () => {
        const { client, store } = clientWithBoard();
        const seen: unknown[] = [];
        let release: (() => void) | null = null;

        const send = actionFrom(client, () =>
            useLiveAction(
                (dto: { title: string }) =>
                    new Promise<Card>(resolve => {
                        release = () => resolve({ id: '2', title: dto.title });
                    }),
                {
                    optimistic: [{
                        on: listDescriptor,
                        apply: (draft, dto) => {
                            draft.push({ id: 'temp', title: dto.title });
                        }
                    }]
                }
            )
        );

        const pending = send({ title: 'Linus' });
        seen.push(store.getSnapshot().data);

        release!();
        await pending;
        seen.push(store.getSnapshot().data);

        expect(seen[0]).toEqual([{ id: '1', title: 'Ada' }, { id: 'temp', title: 'Linus' }]);
        expect(seen[1]).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('drops the overlay when the action fails', async () => {
        const { client, store } = clientWithBoard();

        const send = actionFrom(client, () =>
            useLiveAction(
                async () => {
                    throw new Error('rejected by the server');
                },
                {
                    optimistic: [{
                        on: listDescriptor,
                        apply: draft => {
                            draft.push({ id: 'temp', title: 'never' });
                        }
                    }]
                }
            )
        );

        await expect(send({})).rejects.toThrow('rejected by the server');
        expect(store.getSnapshot().data).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('an action with no optimistic entry just runs', async () => {
        const { client, store } = clientWithBoard();

        const send = actionFrom(client, () => useLiveAction(async (dto: { title: string }) => dto.title));

        await expect(send({ title: 'plain' })).resolves.toBe('plain');
        expect(store.getSnapshot().data).toEqual([{ id: '1', title: 'Ada' }]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/live/test/use-live-action.test.ts`
Expected: FAIL — `useLiveAction` não é exportado.

- [ ] **Step 3: Write the optimistic types**

Crie `packages/live/src/client/optimistic.ts`:

```ts
import type { LiveDataOf, LiveDescriptor } from '../shared/descriptor';

/**
 * One optimistic projection: which resource it targets, and how the action's
 * payload changes it.
 *
 * `on` is what makes `draft` typed. Without naming the target, the draft would
 * have to be `any`, and an optimistic update on `any` is a guess the compiler
 * cannot check.
 */
export interface OptimisticEntry<Target, Dto> {
    on: Target;
    apply: (draft: LiveDataOf<Target extends LiveDescriptor<infer R> ? R : never>, dto: Dto) => void;
}

/** Maps a tuple of descriptors to the matching tuple of optimistic entries. */
export type OptimisticList<Targets extends readonly unknown[], Dto> = {
    [K in keyof Targets]: OptimisticEntry<Targets[K], Dto>;
};
```

- [ ] **Step 4: Write the hook**

Em `packages/live/src/client/react.ts`, acrescente `useCallback` e `useRef` ao import de `react`, os imports novos, e o hook:

```ts
import { useCallback, useRef } from 'react';
import type { OptimisticList } from './optimistic';
```

(junte-os ao import de `react` já existente em vez de criar um segundo)

```ts
/**
 * Run an action, showing its expected effect immediately.
 *
 * The overlay lives above the confirmed snapshot, so a server patch arriving
 * mid-flight lands underneath it and nothing flickers. It is removed when the
 * action settles, either way.
 */
export function useLiveAction<
    Dto,
    Result,
    const Targets extends readonly LiveDescriptor<any>[]
>(
    action: (dto: Dto) => Promise<Result>,
    options: { optimistic?: OptimisticList<Targets, Dto> } = {}
): (dto: Dto) => Promise<Result> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLiveAction() requires a <LiveProvider client={...}> above it in the tree.');
    }

    // The array is a fresh literal on every render; a ref keeps the returned
    // function stable without making the dependency list lie.
    const specs = useRef<readonly { on: LiveDescriptor<any>; apply: (draft: any, dto: Dto) => void }[]>([]);
    specs.current = (options.optimistic ?? []) as readonly {
        on: LiveDescriptor<any>;
        apply: (draft: any, dto: Dto) => void;
    }[];

    return useCallback(async (dto: Dto): Promise<Result> => {
        const remove = specs.current.map(spec =>
            client.overlay(resourceIdOf(spec.on), draft => spec.apply(draft, dto))
        );

        try {
            return await action(dto);
        } finally {
            for (const drop of remove) {
                drop();
            }
        }
    }, [client, action]);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/live/test/use-live-action.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 6: Prove the inference, since no runtime test can**

Crie `packages/live/test/types/optimistic-types.ts`:

```ts
import { useLive, useLiveAction } from '../../src/client/react';
import type { LiveDescriptor } from '../../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

interface CreateCardDto {
    title: string;
}

declare const list: LiveDescriptor<{ query: { status?: string }; response: Card[] }>;
declare const create: (dto: CreateCardDto) => Promise<Card>;

export function typeChecks(): void {
    const state = useLive(list, { query: { status: 'open' } });

    // `data` is Card[] | undefined, so this compiles and `title` is a string.
    const first: string | undefined = state.data?.[0]?.title;
    void first;

    const send = useLiveAction(create, {
        optimistic: [{
            on: list,
            apply: (draft, dto) => {
                // `draft` is Card[] and `dto` is CreateCardDto, both inferred.
                draft.push({ id: 'temp', title: dto.title });
            }
        }]
    });

    void send({ title: 'inferred' });
}
```

Crie `packages/live/tsconfig.types.json`:

```json
{
  "extends": "./tsconfig.json",
  "references": [],
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*", "test/types/**/*"]
}
```

- [ ] **Step 7: Run the type check**

Run: `bunx tsc -p packages/live/tsconfig.types.json`
Expected: sem saída (sucesso).

Se o `tsc` reclamar de `composite`/`references` por causa do `tsconfig.json` da raiz, rode a checagem listando os arquivos direto, o que evita o modo de projeto:

```bash
bunx tsc --noEmit --strict --target ES2021 --module CommonJS --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --esModuleInterop packages/live/test/types/optimistic-types.ts
```

Se a inferência falhar — `draft` vindo como `any` ou `unknown` — o culpado é o mapeamento de tupla em `OptimisticList`. O plano B é uma função auxiliar, que infere por argumento em vez de por posição de tupla, e que a spec aceitaria igual:

```ts
export function optimistic<R, Dto>(
    on: LiveDescriptor<R>,
    apply: (draft: LiveDataOf<R>, dto: Dto) => void
): OptimisticEntry<LiveDescriptor<R>, Dto> {
    return { on, apply };
}
```

com uso `optimistic: [optimistic(api.cards.list, (draft, dto: CreateCardDto) => { ... })]`. Registre a troca aqui se precisar dela.

- [ ] **Step 8: Export and commit**

Em `packages/live/src/index.ts`:

```ts
export type { OptimisticEntry, OptimisticList } from './client/optimistic';
```

Run: `bun test packages/live`
Expected: PASS.

```bash
git add packages/live/src/client packages/live/src/index.ts packages/live/tsconfig.types.json packages/live/test/use-live-action.test.ts packages/live/test/types
git commit -m "feat(live): add useLiveAction with typed optimistic targets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 13: Aceitação ponta a ponta e documentação

O critério de aceite 2 da §12 é a razão de existir desta fase: **uma escrita feita fora da aplicação atualiza a tela**. As doze tasks anteriores provaram cada peça isoladamente; esta prova o caminho inteiro, com WebSocket de verdade, banco de verdade e nenhuma linha de broadcast.

**Files:**
- Test: `packages/live/test/acceptance-fase-2.test.ts` (criar)
- Create: `docs/carno/docs/live/scaling.md`
- Create: `docs/carno/docs/live/typed-client.md`
- Modify: `docs/carno/docs/live/overview.md`
- Modify: `docs/carno/sidebars.ts`

**Interfaces:**
- Consumes: tudo. Nenhuma API nova.

- [ ] **Step 1: Write the acceptance test**

Crie `packages/live/test/acceptance-fase-2.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '../../orm/dist/index.js';
import { withDatabase } from '../../orm/dist/testing/with-database.js';
import { Body, Controller, Get, Post, Query } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { resetLiveRuntime } from '../src/runtime';
import type { LiveAuthorizationRequest, LiveAuthorizer } from '../src/auth/authorizer';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live2_cards (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE);'
];

@Entity({ tableName: 'live2_cards' })
class Card extends BaseEntity<Card> {
    @PrimaryKey()
    id!: number;

    @Property()
    title!: string;

    @Property()
    done!: boolean;
}

@Controller('/cards')
class CardsController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list(@Query('done') done?: string) {
        const cards = await Card.find(done === undefined ? {} : { done: done === 'true' });
        return cards.map(card => ({ id: card.id, title: card.title }));
    }

    @Post('/search')
    @Live({ key: 'id', shared: 'public' })
    async search(@Body() filter: { contains: string }) {
        const cards = await Card.find({});
        return cards
            .filter(card => card.title.includes(filter.contains))
            .map(card => ({ id: card.id, title: card.title }));
    }
}

class DenyEveryone implements LiveAuthorizer {
    authorize(request: LiveAuthorizationRequest): boolean {
        void request;
        return false;
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

    async wait(predicate: (message: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
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

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

afterEach(() => {
    statementObserver.reset();
    resetLiveRuntime();
});

describePostgres('Live Resources phase 2 acceptance', () => {
    test('a write that never touched the application reaches the screen (criterion 2)', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            const harness = await createTestHarness({
                controllers: [CardsController],
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    config: { coalesceMs: 5 },
                    pgNotify: {
                        tables: [{ table: 'live2_cards', primaryKey: 'id' }],
                        channel: 'carno_live_acceptance'
                    }
                })],
                listen: true
            });

            // The plugin installs the triggers from inside the WebSocket
            // builder, which is not awaited: give the DDL a moment to land.
            await new Promise(resolve => setTimeout(resolve, 500));

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({ t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} } });
            await probe.wait(message => message.t === 'snapshot');

            // No entity, no repository, no ORM: a migration or a psql session.
            await executeSql(`INSERT INTO live2_cards (title, done) VALUES ('from outside', false);`);

            const patch = await probe.wait(message => message.t === 'patch');

            probe.close();
            await harness.close();

            expect(patch).toMatchObject({ t: 'patch', sid: 's1' });
            expect(JSON.stringify((patch as { ops: unknown[] }).ops)).toContain('from outside');
        });
    });

    test('a live @Post() answers plain JSON and also updates over the socket', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [CardsController],
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            await Card.create({ title: 'alpha', done: false });

            // The same route, over plain HTTP, with no WebSocket in sight.
            const response = await fetch(`http://127.0.0.1:${harness.port}/cards/search`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ contains: 'alp' })
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual([{ id: 1, title: 'alpha' }]);

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({
                t: 'sub',
                sid: 's1',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'alp' } }
            });

            const snapshot = await probe.wait(message => message.t === 'snapshot');
            expect((snapshot as { data: unknown }).data).toEqual([{ id: 1, title: 'alpha' }]);

            await Card.create({ title: 'alphabet', done: false });
            const patch = await probe.wait(message => message.t === 'patch');

            probe.close();
            await harness.close();

            expect(JSON.stringify((patch as { ops: unknown[] }).ops)).toContain('alphabet');
        });
    });

    test('two subscriptions with different bodies do not share an instance', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [CardsController],
                plugins: [LivePlugin.create({ controllers: [CardsController], config: { coalesceMs: 5 } })],
                listen: true
            });

            await Card.create({ title: 'alpha', done: false });
            await Card.create({ title: 'beta', done: false });

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({
                t: 'sub',
                sid: 'a',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'alp' } }
            });
            probe.send({
                t: 'sub',
                sid: 'b',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'bet' } }
            });

            const first = await probe.wait(message => message.t === 'snapshot' && message.sid === 'a');
            const second = await probe.wait(message => message.t === 'snapshot' && message.sid === 'b');

            probe.close();
            await harness.close();

            expect((first as { data: unknown }).data).toEqual([{ id: 1, title: 'alpha' }]);
            expect((second as { data: unknown }).data).toEqual([{ id: 2, title: 'beta' }]);
        });
    });

    test('an unauthorized connection is told so and gets no data', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [CardsController],
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    authorizer: new DenyEveryone(),
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({ t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} } });

            const error = await probe.wait(message => message.t === 'error');

            probe.close();
            await harness.close();

            expect(error).toMatchObject({ t: 'error', sid: 's1', code: 'forbidden' });
            expect(probe.received.some(message => message.t === 'snapshot')).toBe(false);
        });
    });
});
```

- [ ] **Step 2: Run the acceptance test**

Run: `bun test packages/live/test/acceptance-fase-2.test.ts`
Expected: PASS, 4 testes.

O primeiro teste importa de `../../orm/dist` e `../../core/dist`, como o de aceitação da Fase 1 já faz. Se os `dist` estiverem velhos, reconstrua:

```bash
bun run --cwd packages/orm build && bun run --cwd packages/core build
```

- [ ] **Step 3: Run every suite this phase touched**

Run: `bun test packages/live packages/client packages/orm`
Expected: PASS.

- [ ] **Step 4: Commit the acceptance test**

```bash
git add packages/live/test/acceptance-fase-2.test.ts
git commit -m "test(live): prove phase 2 acceptance end to end

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Write the scaling page**

Crie `docs/carno/docs/live/scaling.md`. Em inglês, no tom de `overview.md`. A estrutura, com o conteúdo obrigatório de cada seção:

```md
---
sidebar_position: 2
---

# Scaling live resources

<!-- One paragraph: phase 1 covered writes made through the ORM in one process.
     This page covers the other two axes: writes made by someone else, and more
     than one process. -->

## Writes the ORM never saw

<!-- The problem: a migration, a psql session, a legacy service. Why the app
     emitter cannot see them. What the trigger produces, and that it is the same
     key vocabulary. Requires PostgreSQL 11 or newer. -->

```ts
LivePlugin.create({
    controllers: [CardsController],
    pgNotify: {
        tables: [
            { table: 'cards', primaryKey: 'id' },
            { table: 'card_labels', primaryKey: 'id' },
        ],
    },
});
```

### What gets installed

<!-- One `carno_live_notify()` function plus one AFTER INSERT OR UPDATE OR
     DELETE trigger per table, named carno_live_<table>. Both are created at
     boot and are idempotent. Show the payload shape { t, i, c }. -->

### What it costs

<!-- One trigger execution per row written, one jsonb diff per UPDATE, one
     notification per changed row. An UPDATE that changes nothing sends nothing.
     A payload over 7000 bytes degrades to the whole table. -->

### The gap after a reconnect

<!-- A dropped LISTEN connection loses whatever was published meanwhile, with no
     way to ask what was missed. On reconnect every watched table is invalidated.
     Say plainly that this is a recompute storm by design, and that it is the
     correct trade. -->

## More than one process

<!-- Why the app emitter and LiveService.invalidate() are local, and what the
     distributed bus does about it. -->

```ts
LivePlugin.create({
    controllers: [CardsController],
    distributed: { transport: 'pg-notify' },
});
```

### Node identity and echo

<!-- Each process gets a node id; Postgres echoes a notification back to the
     sender, and the node id is what stops it becoming a second invalidation. -->

### Combining both

<!-- With pgNotify on, the app emitter skips the covered tables: the trigger
     already told every node. Show that the two together need no extra config. -->

## Choosing

<!-- A short table: single process + ORM-only writes -> nothing; single process
     + outside writes -> pgNotify; cluster + ORM-only writes -> distributed;
     cluster + outside writes -> both. -->
```

- [ ] **Step 6: Write the typed client page**

Crie `docs/carno/docs/live/typed-client.md`:

```md
---
sidebar_position: 3
---

# Typed subscriptions

<!-- One descriptor, two uses today: an HTTP call and a subscription. Say that
     prefetch (SSR) is not here yet. -->

## What the codegen emits

<!-- The generated file gains `routes`, a tree of descriptors typed through App.
     Show the emitted shape and say that `dependsOn` never leaves the server,
     and that the controller name only appears for @Live() routes. -->

```ts
export const routes = {
  cards: {
    list: { method: "get", path: "/cards", resourceId: "CardsController.list", live: { shared: "tenant", key: "id" } } as RouteDescriptor<App["cards"]["get"]>,
  },
} as const;
```

## One object, two uses

```ts
import { createApi } from '@carno.js/client';
import { routes } from './generated/app';

export const api = createApi(routes, { baseUrl: 'http://localhost:3000' });
```

```tsx
// HTTP, as before
const { data } = await api.cards.list({ query: { status: 'open' } });

// Subscription, same object
const cards = useLive(api.cards.list, { query: { status: 'open' } });
```

<!-- Note the input shape { params, query, body } and why it is structured
     rather than flat. -->

## Optimistic updates

```tsx
const create = useLiveAction(api.cards.create, {
    optimistic: [
        { on: api.cards.list, apply: (draft, dto) => draft.push({ id: 'temp', title: dto.title }) },
    ],
});
```

<!-- Explain: the overlay lives above the confirmed snapshot; a server patch
     arriving mid-flight lands underneath and the overlay is re-projected; the
     overlay is removed when the action settles, and there is a short window
     before the server's patch arrives. `apply` mutates a draft. -->

## Build-time validation

<!-- The five rules the scanner now reports, with one example of each message,
     and the sentence from the spec: same rule, two moments. -->
```

- [ ] **Step 7: Link the new pages**

Em `docs/carno/docs/live/overview.md`:

- na seção `### Handler rules`, troque a regra de verbo por "GET and POST", explicando que o critério é idempotência e que `@Body()` é input de primeira classe num `@Post()` live;
- na seção `## Validation and troubleshooting`, acrescente `forbidden` à lista de códigos de erro, com uma frase sobre o `LiveAuthorizer`;
- no fim da introdução, acrescente dois links: "For clusters and writes made outside the application, see [Scaling live resources](./scaling.md). For typed subscriptions and optimistic updates, see [Typed subscriptions](./typed-client.md)."

Em `docs/carno/sidebars.ts`:

```ts
    {
      type: 'category',
      label: 'Live',
      items: ['live/overview', 'live/scaling', 'live/typed-client'],
    },
```

- [ ] **Step 8: Build the docs**

Run: `bun run --cwd docs/carno build`
Expected: build sem erro. Docusaurus falha em link quebrado, então isto também valida os dois links novos.

- [ ] **Step 9: Commit**

```bash
git add docs/carno/docs/live docs/carno/sidebars.ts
git commit -m "docs(live): document scaling and the typed client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
## Cobertura da spec

Cada item da spec que a §13 coloca na Fase 2, e onde ele é implementado. O que não está aqui está nomeado como fase.

| Spec | Item | Onde |
| :--- | :--- | :--- |
| §4.4 | `PgNotifyEmitter`, trigger por tabela, mesmo vocabulário de chave | Task 5 |
| §4.4 | `InvalidationBus` distribuído | Task 6 (só `pg-notify`; ver desvio 2) |
| §4.5 | `inputs` do `sub` carrega body | Tasks 1, 2 |
| §5.2 | `@Live()` em `@Post()`, `@Body()` como input | Task 2 |
| §5.2 | `PUT`/`PATCH`/`DELETE` continuam proibidos | Task 2 (runtime), Task 8 (build) |
| §5.4 | Autorização reavaliada depois do `sub` | Task 3 (ver desvio 1) |
| §5.6 | As quatro validações também em build | Task 8 |
| §4.6 | Warn para coleção com `id` e sem `key` | Task 8 |
| §6.3 | Otimismo como overlay, com `on` | Tasks 11, 12 |
| §7 | `RouteSchema.live`, `resourceId`, descriptors | Tasks 7, 9 |
| §7 | `dependsOn` não vaza pro cliente | Task 7 (nunca é emitido) |
| §7 | `ScanWarning` com arquivo e linha | Task 8 |
| §7 | Um descriptor, usos de HTTP e de subscrição | Tasks 9, 10 |
| §7 | Hash de input compartilhado inclui o body | Task 1 |
| §12 | Critério 2 — escrita fora da aplicação chega na tela | Task 13 |
| §12 | Critério 8 continua valendo com body nos inputs | Task 13 |

Fora desta fase, com a fase de destino:

| Spec | Item | Fase |
| :--- | :--- | :--- |
| §7 | `prefetch()` (SSR) | 3 — depende de ilhas (desvio 4) |
| §6.2 | Adapters Angular, Vue e vanilla | 3 |
| §8.3 | Ilhas em `@carno.js/views` | 3 — critério 7 |
| §8.4 | Degradação para SSE e polling | 3 |
| §4.4 | Bus de Redis e de fila | 3 ou quando alguém precisar (desvio 2) |
| §10 | Métricas no `ObservabilityService` | 3 |

## Riscos deste plano

**1. `sql.listen` existe no runtime e não na documentação.** É o alicerce das Tasks 4, 5 e 6, e a fonte oficial do Bun diz que não está implementado. O runtime 1.4.0 discorda: as funções existem e chamam um `listenable` interno. A Task 4 Step 1 é um teste contra banco real, escrito antes de qualquer outra coisa, exatamente para essa dúvida morrer cedo — e traz o plano B (outbox com polling) escrito, atrás da mesma interface.

**2. A inferência de tupla do `OptimisticList` pode não pegar.** O mapeamento homomórfico sobre a tupla inferida é a parte do plano que eu não consigo verificar sem compilar. A Task 12 Step 7 compila um arquivo que só passa se a inferência funcionar, e traz o plano B — uma função `optimistic()` que infere por argumento, o que TypeScript faz sem truque nenhum.

**3. O trigger é por linha.** Um `UPDATE cards SET done = true WHERE tenant_id = 7` que pega cem mil linhas dispara cem mil `pg_notify`. Do lado do live, a janela de `coalesceMs` e o `Set` de instâncias absorvem quase tudo; do lado do banco, o custo é real e é do banco. A documentação da Task 13 diz para não colocar tabelas de escrita em lote no `pgNotify`, mas isso é conselho, não guarda. Se virar problema, o caminho é um trigger `FOR EACH STATEMENT` que notifica só a tabela.

**4. A instalação do trigger não é aguardada.** O `LivePlugin` roda o DDL dentro do builder do WebSocket, que é síncrono, então o `attach()` é `void` com um `console.error` em caso de falha. Na prática, uma escrita nos primeiros milissegundos depois do boot pode não ser notificada, e é por isso que o teste de aceitação da Task 13 espera 500 ms antes de escrever. Consertar direito exige um hook de bootstrap assíncrono no core, que é trabalho separado.

**5. A janela do overlay otimista.** Descrita no desvio 5. Entre a resposta da ação e o patch do servidor, a tela volta ao confirmado antigo por alguns milissegundos. Fechar isso é protocolo novo.

**6. O adapter React continua sem teste de interação.** As Tasks 10 e 12 testam por `renderToStaticMarkup`, o que prova que o hook lê a store e que a ação aplica e remove o overlay — mas não exercita o caminho de re-renderização do `useSyncExternalStore`, que é justamente onde a estabilidade referencial importa. A Fase 1 tinha o mesmo buraco. Fechá-lo pede uma dependência de teste nova (`@testing-library/react` ou `react-test-renderer`), o que esbarra na regra de zero dependências novas; vale reabrir essa regra para `devDependencies` na Fase 3.
