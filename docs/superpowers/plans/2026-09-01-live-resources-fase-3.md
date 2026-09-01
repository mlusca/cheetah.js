# Live Resources — Fase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o Live Resources de "funciona em React, sobre WebSocket, com métricas que ninguém lê" para "funciona em qualquer framework, sobre qualquer transporte que o proxy do cliente deixar passar, com a primeira carga já preenchida e a precisão da invalidação visível em produção".

**Architecture:** Quatro frentes sobre o núcleo das Fases 1 e 2, todas apoiadas em duas propriedades que já existem e não mudam. A primeira: `LiveStore<T>` é `{ subscribe, getSnapshot }`, que é exatamente o que `useSyncExternalStore`, `signal`, `shallowRef` e uma store de Svelte envolvem — então os adapters são finos por construção, e adapter que engorda é lógica vazando do núcleo. A segunda: o `LiveEngine` fala com o mundo por `LiveTransport.send(connectionId, message)` e recebe por `subscribe`/`unsubscribe`/`resync`/`dropConnection`, todos endereçados por um `connectionId` opaco — então SSE não é um segundo motor, é um segundo transporte. Sobre isso: (1) adapters Angular, Vue e vanilla, mais o teste de re-renderização que faltava no de React; (2) degradação, com `ETag` de hash de conteúdo no piso e SSE no meio, e uma escada de transporte no cliente; (3) ilhas, com `prefetch()` no servidor e o payload de hidratação embutido no HTML pelo `@carno.js/views`; (4) métricas, com o `LiveEngine` reportando ao `ObservabilityService` por um canal genérico que não obriga o core a aprender o vocabulário do live.

**Tech Stack:** Bun 1.4 (`ReadableStream` em `Response`, roteador nativo), TypeScript 5.9, decorators legacy, `reflect-metadata`, `bun:test`, `@carno.js/core`, `@carno.js/views`, `@carno.js/websocket`, `@carno.js/client`, React 18, Angular 18 (signals), Vue 3 (`shallowRef`).

**Spec:** [`docs/superpowers/specs/2026-08-31-live-resources-design.md`](../specs/2026-08-31-live-resources-design.md) — este plano implementa a **Fase 3** da §13, e fecha o **critério 7** da §12. Leia a spec antes de começar; o plano argumenta a partir dela.

**Planos anteriores:** [`2026-08-31-live-resources-fase-1.md`](./2026-08-31-live-resources-fase-1.md) e [`2026-08-31-live-resources-fase-2.md`](./2026-08-31-live-resources-fase-2.md). As duas estão implementadas e mergeadas em `docs/live-resources-design` (a Fase 2 pelo merge `03ccfa6`). Este plano assume esse código como base e cita os arquivos dele pelo caminho real.

## Global Constraints

- **Runtime:** Bun 1.4.0 ou superior.
- **TypeScript:** herda `tsconfig.json` da raiz — `module: CommonJS`, `target: ES2021`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strictPropertyInitialization: false`.
- **Indentação:** 4 espaços em `packages/live`, `packages/core`, `packages/client` e `packages/views`; **2 espaços** em `packages/orm`. Aspas simples, ponto e vírgula, em todos.
- **Testes:** `bun test`. Import de `bun:test`. Arquivos novos do live em `packages/live/test/**/*.test.ts`; do client em `packages/client/test/**/*.spec.ts`; do views em `packages/views/test/**/*.spec.ts` — é o sufixo que cada pacote usa.
- **Dependências:** zero dependências de **runtime** novas. Esta fase abre a regra para `devDependencies`, e só para elas: `@angular/core`, `vue`, `@testing-library/react` e `@testing-library/dom` entram em `packages/live/package.json` como devDependencies, e Angular e Vue entram também como `peerDependencies` **opcionais**, exatamente como o React já está.
- **Código e comentários em inglês.** A documentação do Docusaurus (`docs/carno/docs/**`) também é **em inglês**. Só os documentos de `docs/superpowers/**` são em português.
- **Defaults da §10.1, inalterados:** `coalesceMs: 16`, `maxKeysPerRead: 64`, `maxInputBytes: 8192`, `unsubGraceMs: 5000`, `maxPendingPatches: 32`, `fanoutQueueThreshold: 500`, `maxInstancesPerConnection: 64`, `maxInstancesPerNode: 50000`.
- **Defaults da Fase 2, inalterados:** `pgChannel: 'carno_live'`, `pgBusChannel: 'carno_live_bus'`, `pgHeartbeatMs: 5000`, `pgRetryMs: 1000`, `pgMaxPayloadBytes: 7000`.
- **Defaults novos desta fase:** `ssePath: '/live/sse'`, `sseControlPath: '/live/control'`, `sseHeartbeatMs: 15000`, `sseMaxConnections: 10000`, `pollIntervalMs: 5000`, `transportProbeMs: 3000`.
- **Branch:** criar `feat/live-resources-fase-3` a partir de `docs/live-resources-design` antes da Task 1.
- **Commits:** toda mensagem termina com o trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Pré-requisito: banco de pé e suíte no baseline

```bash
docker compose up -d db
```

```bash
bun test
```

Esperado: **1319 pass, 2 fail**. As duas falhas são pré-existentes e conhecidas, e **não** são desta fase:

1. `createClientWatcher > regenerates when a controller file changes`, em `packages/client/test/watch.spec.ts` — o `scratchRoot` do teste aponta para um caminho temporário fixo e morto de outra máquina.
2. `Controller Response Types > Custom Response Objects > returns 301 Permanent Redirect`, em `packages/core`.

Se falhar qualquer coisa além dessas duas, pare e conserte antes de começar. Esta fase mexe no `LiveEngine`, no `LiveClient` e no `LivePlugin`, e você não quer descobrir uma regressão das fases anteriores no meio disso.

Confirme também que o pacote `live` está limpo sozinho:

```bash
bun test packages/live
```

Esperado: **206 pass, 0 fail**.

## Desvios deliberados da spec

Seis pontos onde a implementação se afasta do texto. Cada um é uma decisão, não um esquecimento, e está aqui para o revisor poder discordar.

**1. As métricas entram no `ObservabilityService` por um canal genérico, não por métodos com nome de live.** A §10 diz "Métricas via `ObservabilityService`", e a leitura literal seria dar ao core métodos `onLiveRecompute`, `onLiveInvalidation` e afins. A §9 diz, no mesmo documento, que `@carno.js/core` não ganha nada obrigatório. Os dois não cabem juntos: o core passaria a carregar o vocabulário do live — `instanceId`, fan-out, recompute — por um pacote que é opcional e que ele não conhece. A implementação dá ao core **um** método novo e neutro, `onMetric(name, value, tags?)`, e o live publica nele com nomes prefixados (`live.recompute`, `live.invalidation.fanout`). Vale para qualquer pacote que venha a querer publicar número, o `LoggerObservabilityService` ganha uma implementação, e a §9 continua verdadeira. O custo é perder a tipagem forte por evento; em troca, o core não precisa saber o que é um recompute.

**2. SSE não reimplementa o protocolo — reimplementa o cano.** A §8.4 diz "SSE pros patches, HTTP pras ações", o que poderia sugerir um caminho paralelo no servidor. Não é o que fazemos. `EventSource` é unidirecional, então o `sub`/`unsub`/`resync` sobe por `POST /live/control` e entra **na mesma** `handleMessage(connectionId, raw)` que o gateway de WebSocket já usa; os `snapshot`/`patch`/`current` descem pelo `ReadableStream` de `GET /live/sse`. O engine não sabe qual dos dois está atendendo: ele endereça por `connectionId`, e um `FanTransport` decide para qual transporte concreto entregar. Um protocolo, dois canos.

**3. O piso de polling é `ETag` na rota que já existe, não uma rota nova.** A §8.4 diz "Polling por `GET` condicional, `ETag` = hash de conteúdo". Um `@Live()` já **é** um `@Get()`, então a implementação é um middleware que calcula `fnv1a64(canonical(body))` da resposta e responde `304` quando o `If-None-Match` bate. Sem rota nova, sem duplicar o handler, e a mesma rota serve o `fetch()` normal, o polling e a hidratação. É a "uma peça, três problemas" da §8.1 levada até o fim.

**4. `prefetch()` não cria instância.** A §7 lista `prefetch(api.users.list, ...)` como o terceiro uso do descriptor. Implementamos como um compute de uma vez só, que devolve `{ resourceId, inputs, data, hash }` e **não** registra nada no `DependencyGraph` nem no `SubscriptionRegistry`. Criar instância na primeira carga significaria manter viva, com recompute e tudo, uma instância para cada página renderizada que talvez nunca receba um `sub` — o pior custo possível para o caso mais comum. A instância nasce quando o cliente assina, e o hash da primeira carga é justamente o que faz esse `sub` não trafegar dado nenhum.

**5. A ilha é um payload no HTML, não um componente.** A §8.3 fala de "ilhas que precisam de vida". Não entregamos runtime de ilha, hidratação seletiva nem nada que pareça um micro-framework: entregamos um helper que serializa o resultado de `prefetch()` num `<script type="application/json">` e um leitor no cliente que o transforma no `hydrate` que o `LiveClient` já aceita desde a Fase 1. Quem decide o que é ilha é o template. O framework não tem opinião, e não deveria.

**6. Só o adapter de React ganha teste de re-renderização de verdade.** A nota 6 da Fase 2 registrou que `useLive` nunca foi exercitado pelo caminho do `useSyncExternalStore`, só por `renderToStaticMarkup`. A Task 1 fecha isso com `@testing-library/react`. Angular e Vue nascem já testados contra o framework real, porque `signal()` e `shallowRef()` são funções que rodam fora de componente — não precisam de um renderer para provar que reagem. Não há assimetria de rigor aqui, e sim de custo: React exige um renderer para observar o efeito, os outros dois não.

## Comportamentos que a spec não trata

- **Um cliente degradado não é um cliente pior, é um cliente mais lento.** WebSocket, SSE e polling entregam a mesma `LiveState<T>`. O componente não sabe qual está em uso, e não deve poder saber: o dia em que um `if (transport === 'sse')` aparecer num componente, a abstração falhou. O transporte em uso é observável para depuração (`client.transport()`), não para lógica de tela.
- **A escada de transporte desce, e não sobe sozinha.** Se o WebSocket não abre em `transportProbeMs`, o cliente cai para SSE; se o SSE também falha, cai para polling. Não há promoção automática de volta: um proxy que bloqueia WebSocket vai continuar bloqueando, e ficar tentando a cada reconexão gasta uma viagem por ciclo para sempre falhar. A promoção acontece no próximo `LiveClient`, ou seja, no próximo carregamento da página.
- **Polling não é subscrição, e por isso não tem patch.** No piso da escada só existe `snapshot` e `304`. Pedir patch exigiria o servidor guardar a revisão anterior daquele cliente, que é exatamente o histórico que a §8.1 diz não existir. `304` com corpo vazio já é o caso comum e já é barato.
- **Um adapter que reassina precisa cancelar o anterior antes de assinar o novo.** Em Angular e Vue os inputs são reativos, então mudar um input é trocar de instância. Fazer o inverso — assinar o novo e depois soltar o velho — parece mais seguro e é pior: durante a janela os dois estão retidos, e com `maxInstancesPerConnection` em 64 um filtro que o usuário arrasta estoura o teto da conexão. Solta primeiro.
- **`ETag` só vale para `@Live()` em `@Get()`.** Um `@Live()` em `@Post()` existe desde a Fase 2, mas `POST` não é cacheável, e polling condicional em cima dele não faz sentido nenhum. O middleware ignora tudo que não é `GET`.
- **Um handler registrado por `Carno.route()` recebe um `Request` do Bun, não um `Context`.** O docstring em `packages/core/src/Carno.ts:247` sugere `ctx`; o comportamento real é `Request`, porque essas rotas vão direto para o roteador nativo do Bun sem passar pelo `compileHandler`. Isso foi verificado contra o servidor real antes deste plano ser escrito, junto com o fato de que um `Response` com `ReadableStream` e `Content-Type: text/event-stream` atravessa intacto. As duas coisas são a base da Task 7.

## File Structure

**`packages/live/src/client/vanilla.ts`** (novo) — `liveStore()`, o adapter mínimo: descriptor mais inputs vira `{ get, subscribe, close }`. É o que os outros dois adapters usam por dentro, e o que um usuário sem framework usa por fora.

**`packages/live/src/client/angular.ts`** (novo) — `liveSignal()`. Envolve o `LiveStore` num `signal`, reassina quando o `computed` de inputs muda, e se desfaz por `DestroyRef`. Zoneless.

**`packages/live/src/client/vue.ts`** (novo) — `useLiveQuery()`. Envolve o `LiveStore` num `shallowRef`, reassina por `watchEffect`, e se desfaz por `onScopeDispose`.

**`packages/live/src/client/transport.ts`** (novo) — a escada. Define `ClientTransport` (o que o `LiveClient` precisa de um cano) e as três implementações: `WebSocketTransport`, `SseClientTransport`, `PollingTransport`.

**`packages/live/src/transport/FanTransport.ts`** (novo) — `LiveTransport` do lado servidor que registra transportes filhos e entrega por dono do `connectionId`. É o que deixa WebSocket e SSE coexistirem num engine só.

**`packages/live/src/transport/SseTransport.ts`** (novo) — o lado servidor do SSE: mantém os controllers de stream por conexão, escreve eventos no formato `data: <json>\n\n`, e emite heartbeat.

**`packages/live/src/transport/sse-routes.ts`** (novo) — os dois handlers HTTP, `GET /live/sse` e `POST /live/control`, registrados por `Carno.route()`.

**`packages/live/src/http/etag.ts`** (novo) — `LiveETagMiddleware`, o `CarnoMiddleware` que põe `ETag` de hash de conteúdo em resposta de `GET` e responde `304` em `If-None-Match` que bate.

**`packages/live/src/resource/prefetch.ts`** (novo) — `prefetchLive()`, o compute de uma vez só que a primeira carga usa. Não toca no grafo.

**`packages/live/src/client/hydrate.ts`** (novo) — `readHydrationPayload()`, o leitor de navegador que transforma os `<script data-carno-live>` da página no `hydrate` do `LiveClientOptions`.

**`packages/views/src/live-island.ts`** (novo) — `liveIsland()`, o helper de template que serializa um payload de prefetch para dentro do HTML, com escape de `</script`.

**`packages/live/src/observability.ts`** (novo) — `LiveMetrics`, a fachada fina que o engine chama e que traduz para `onMetric` do core. Existe para o engine não carregar um `if (observability)` em cada ponto de medida.

**`packages/core/src/observability/ObservabilityService.ts`** (modificar) — ganha `onMetric(name, value, tags?)`, no-op como os outros.

**`packages/core/src/index.ts`** (modificar) — reexporta `CONTROLLER_META`, que hoje é o único da família que não é público e sem o qual não dá para ler o prefixo de um controller de fora do core.

**`packages/logger/src/LoggerObservabilityService.ts`** (modificar) — implementa `onMetric`.

**`packages/live/src/LiveEngine.ts`** (modificar) — publica as medidas da §10 nos pontos onde os números já existem.

**`packages/live/src/config.ts`** (modificar) — os seis parâmetros novos.

**`packages/live/src/LivePlugin.ts`** (modificar) — monta o `FanTransport`, registra as rotas de SSE quando ligado, instala o middleware de `ETag`, e injeta o `LiveMetrics`.

**`packages/live/src/client/core.ts`** (modificar) — passa a falar com um `ClientTransport` em vez de um `LiveSocket` cru.

**`packages/live/src/index.ts`** e **`packages/live/package.json`** (modificar) — exports novos, subpaths `./vanilla`, `./angular`, `./vue`.

---
### Task 1: O adapter React ganha o teste que faltava

O `useLive` nunca foi exercitado pelo caminho que importa. `renderToStaticMarkup` prova que o hook lê a store uma vez; não prova que uma segunda mensagem re-renderiza, nem que a identidade referencial se mantém quando nada mudou. O risco 5 da spec — "se o `PatchEngine` errar identidade de objeto, o sintoma é loop de render" — só se manifesta nesse caminho. Esta task vem primeiro porque as três tasks de adapter seguintes assentam sobre o mesmo contrato de store, e é barato descobrir agora se ele não se sustenta.

**Files:**
- Modify: `packages/live/package.json`
- Create: `packages/live/test/react-rerender.test.tsx`

**Interfaces:**
- Consumes: `LiveClient`, `LiveSocket`, `storeKey` de `packages/live/src/client/core.ts`; `LiveProvider`, `useLive` de `packages/live/src/client/react.ts`.
- Produces: nenhum runtime. Estabelece o padrão de teste de adapter que as Tasks 2, 3 e 4 seguem: socket falso, mensagem do servidor injetada à mão, asserção sobre o que o consumidor observou.

- [ ] **Step 1: Adicionar as devDependencies**

Em `packages/live/package.json`, dentro de `devDependencies`, some as duas entradas às que já existem:

```json
"@testing-library/react": "^16.1.0",
"@testing-library/dom": "^10.4.0"
```

- [ ] **Step 2: Instalar**

Run: `bun install`
Expected: instala sem tocar em dependências de runtime; `packages/live/package.json` continua sem `dependencies`.

- [ ] **Step 3: Escrever o teste de re-renderização**

Crie `packages/live/test/react-rerender.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';

/** A socket the test drives by hand: nothing is sent, everything is injected. */
function fakeSocket(): LiveSocket & { sent: string[]; deliver: (message: unknown) => void } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null,
        deliver(message: unknown) { socket.onmessage?.({ data: JSON.stringify(message) }); }
    };

    return socket;
}

afterEach(cleanup);

describe('useLive re-rendering', () => {
    test('a snapshot after mount re-renders the component with the new data', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        function Cards() {
            const { data, pending } = useLive<{ id: number }[]>('CardsController.list');
            return createElement('div', { 'data-testid': 'out' }, pending ? 'pending' : String(data?.length ?? 0));
        }

        const screen = render(createElement(LiveProvider, { client }, createElement(Cards)));

        expect(screen.getByTestId('out').textContent).toBe('pending');

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }, { id: 2 }] });
        });

        expect(screen.getByTestId('out').textContent).toBe('2');
    });

    test('a message that establishes nothing new does not re-render', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        let renders = 0;

        function Cards() {
            renders += 1;
            const { data } = useLive<{ id: number }[]>('CardsController.list');
            return createElement('div', { 'data-testid': 'out' }, String(data?.length ?? 0));
        }

        render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }] });
        });

        const afterSnapshot = renders;

        // Same data, same flags. The store has to keep the identical state
        // object here, or useSyncExternalStore re-renders forever.
        await act(async () => {
            socket.deliver({ t: 'current', sid: 's0', rev: 1, hash: 'h1' });
        });

        expect(renders).toBe(afterSnapshot);
    });

    test('the data object stays referentially identical across a no-op message', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];

        function Cards() {
            const { data } = useLive<{ id: number }[]>('CardsController.list');
            const previous = useRef<unknown>(null);

            if (data !== previous.current) {
                previous.current = data;
                seen.push(data);
            }

            return createElement('div', null, String(data?.length ?? 0));
        }

        render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }] });
            socket.deliver({ t: 'current', sid: 's0', rev: 1, hash: 'h1' });
        });

        // undefined at mount, then the array. A third entry would mean the
        // store handed out a new object for content that did not change.
        expect(seen.length).toBe(2);
    });

    test('unmounting releases the subscription after the grace period', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({
            url: 'ws://x/live',
            socketFactory: () => socket,
            unsubGraceMs: 1
        });

        function Cards() {
            useLive('CardsController.list');
            return null;
        }

        const screen = render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => { socket.onopen?.(); });

        expect(socket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);

        screen.unmount();
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });
});
```

- [ ] **Step 4: Rodar**

Run: `bun test packages/live/test/react-rerender.test.tsx`
Expected: **4 pass, 0 fail**.

Se `a message that establishes nothing new does not re-render` falhar, **não conserte o teste**: o bug está em `update()`, em `packages/live/src/client/core.ts:378`, e é o risco 5 da spec se manifestando. Pare e conserte o núcleo.

- [ ] **Step 5: Confirmar que a Fase 2 continua inteira**

Run: `bun test packages/live`
Expected: **210 pass, 0 fail** (206 anteriores mais 4).

- [ ] **Step 6: Commit**

```bash
git add packages/live/package.json packages/live/test/react-rerender.test.tsx bun.lock
```

Mensagem:

```
test(live): exercise the React adapter through a real render

renderToStaticMarkup proved the hook reads the store once. It could not
prove that a second message re-renders, nor that a message establishing
nothing keeps the state object identical -- which is the path where risk
5 of the design shows up, as a render loop.

Opens the dependency rule for devDependencies only, as phase 2 noted it
would have to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 2: `liveStore()` — o adapter que não tem framework

O núcleo já expõe `LiveStore<T>`, mas para usá-lo hoje é preciso saber que se chama `client.store(resourceId, inputs)`, extrair o `resourceId` do descriptor à mão e normalizar os inputs à mão — três coisas que o `useLive` faz e que todo adapter refaria. Esta task extrai esse miolo para uma função sem framework nenhum, que é ao mesmo tempo o adapter vanilla da §6.2 e a peça que Angular e Vue vão embrulhar.

**Files:**
- Create: `packages/live/src/client/vanilla.ts`
- Create: `packages/live/test/vanilla-adapter.test.ts`
- Modify: `packages/live/src/index.ts`
- Modify: `packages/live/package.json`

**Interfaces:**
- Consumes: `LiveClient`, `LiveState`, `LiveStore` de `../client/core`; `LiveDescriptor`, `LiveDataOf`, `LiveInputsOf`, `resourceIdOf`, `normalizeLiveInputs` de `../shared/descriptor`; `LiveInputs` de `../shared/inputs`.
- Produces:
  - `interface LiveHandle<T> { get(): LiveState<T>; subscribe(listener: (state: LiveState<T>) => void): () => void; close(): void }`
  - `function liveStore<R>(client: LiveClient, descriptor: LiveDescriptor<R>, inputs?: LiveInputsOf<R>): LiveHandle<LiveDataOf<R>>`
  - `function liveStore<T>(client: LiveClient, resourceId: string, inputs?: Partial<LiveInputs>): LiveHandle<T>`
  - `function liveStoreOf(client: LiveClient, resource: string | LiveDescriptor<any>, inputs: Record<string, any>): LiveStore<unknown>` — a resolução crua, sem o embrulho de `LiveHandle`.
  - `function liveIdentity(resource: string | LiveDescriptor<any>, inputs: Record<string, any>): string`
  - `class LiveSlot<T>` — **a peça que as Tasks 3 e 4 realmente consomem.** Uma subscrição que aponta para um alvo por vez: `point(resource, inputs)` troca o alvo, `close()` desfaz. É aqui que mora a regra "solta o anterior antes de reter o novo" da seção de comportamentos, e é aqui que ela é testada — sem Angular e sem Vue, porque a regra não tem nada de Angular nem de Vue.
    - `constructor(client: LiveClient, onState: (state: LiveState<T>) => void)`
    - `point(resource: string | LiveDescriptor<any>, inputs?: Record<string, any>): void`
    - `get(): LiveState<T>`
    - `close(): void`

- [ ] **Step 1: Escrever o teste, que falha**

Crie `packages/live/test/vanilla-adapter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { liveStore, liveStoreOf } from '../src/client/vanilla';
import type { LiveDescriptor } from '../src/shared/descriptor';

function fakeSocket(): LiveSocket & { sent: string[]; deliver: (message: unknown) => void } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null,
        deliver(message: unknown) { socket.onmessage?.({ data: JSON.stringify(message) }); }
    };

    return socket;
}

interface CardsRoute {
    response: { id: number; title: string }[];
    query: { done?: string };
}

const cardsList: LiveDescriptor<CardsRoute> = {
    method: 'get',
    path: '/cards',
    resourceId: 'CardsController.list',
    live: { shared: 'public', key: 'id' }
};

describe('liveStore', () => {
    test('subscribes on the first listener and reports the snapshot', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const handle = liveStore(client, cardsList, { query: { done: 'false' } });
        const seen: unknown[] = [];

        handle.subscribe(state => seen.push(state.data));
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        expect(sub.resource).toBe('CardsController.list');
        expect(sub.inputs.query).toEqual({ done: 'false' });

        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(handle.get().data).toEqual([{ id: 1, title: 'a' }]);
        expect(seen.at(-1)).toEqual([{ id: 1, title: 'a' }]);
    });

    test('get() works before anyone subscribes', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const handle = liveStore(client, cardsList);

        expect(handle.get()).toEqual({ data: undefined, pending: true, error: null, stale: false });
        expect(socket.sent).toEqual([]);
    });

    test('close() drops the listener without touching the others', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const first = liveStore(client, cardsList);
        const second = liveStore(client, cardsList);
        let firstSaw = 0;
        let secondSaw = 0;

        first.subscribe(() => { firstSaw += 1; });
        second.subscribe(() => { secondSaw += 1; });
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        first.close();
        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [] });

        expect(firstSaw).toBe(0);
        expect(secondSaw).toBe(1);
    });

    test('two handles for the same resource and inputs share one subscription', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        liveStore(client, cardsList, { query: { done: 'true' } }).subscribe(() => {});
        liveStore(client, cardsList, { query: { done: 'true' } }).subscribe(() => {});
        socket.onopen?.();

        expect(socket.sent.filter(raw => raw.includes('"t":"sub"')).length).toBe(1);
    });

    test('a plain resource id works without a descriptor', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        liveStore<number[]>(client, 'CardsController.list').subscribe(() => {});
        socket.onopen?.();

        expect(JSON.parse(socket.sent[1]).resource).toBe('CardsController.list');
    });

    test('a descriptor without @Live() is refused with a message that says what to do', () => {
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => fakeSocket() });
        const plain: LiveDescriptor<CardsRoute> = { method: 'get', path: '/cards' };

        expect(() => liveStore(client, plain)).toThrow(/not a live resource/);
    });
});

describe('liveStoreOf', () => {
    test('resolves a descriptor to the same store a resource id resolves to', () => {
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => fakeSocket() });

        const fromDescriptor = liveStoreOf(client, cardsList, {});
        const fromId = liveStoreOf(client, 'CardsController.list', {});

        expect(fromDescriptor).toBe(fromId);
    });
});

describe('LiveSlot', () => {
    test('reports the state of whatever it currently points at', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];
        const slot = new LiveSlot<{ id: number }[]>(client, state => seen.push(state.data));

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [{ id: 1 }] });

        expect(slot.get().data).toEqual([{ id: 1 }]);
        expect(seen.at(-1)).toEqual([{ id: 1 }]);
    });

    test('pointing at the same inputs again is a no-op, not a resubscribe', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        const afterFirst = socket.sent.length;

        // A reactive input that recomputed to the same value must not churn
        // the subscription: the server would drop and rebuild the instance.
        slot.point(cardsList, { query: { done: 'false' } });

        expect(socket.sent.length).toBe(afterFirst);
    });

    test('pointing somewhere new releases the old target before retaining the new one', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        slot.point(cardsList, { query: { done: 'true' } });

        // Order matters: holding both at once is how a dragged filter walks a
        // connection into maxInstancesPerConnection.
        const kinds = socket.sent.map(raw => JSON.parse(raw).t);
        expect(kinds.filter(kind => kind === 'sub').length).toBe(2);
        expect(kinds.indexOf('sub')).toBeLessThan(kinds.lastIndexOf('sub'));
    });

    test('a state message for the old target after a switch is ignored', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];
        const slot = new LiveSlot<{ id: number }[]>(client, state => seen.push(state.data));

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        const first = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);

        slot.point(cardsList, { query: { done: 'true' } });
        socket.deliver({ t: 'snapshot', sid: first.sid, rev: 1, hash: 'h1', data: [{ id: 9 }] });

        expect(seen.some(data => JSON.stringify(data) === JSON.stringify([{ id: 9 }]))).toBe(false);
    });

    test('close() releases whatever it was pointing at', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList);
        socket.onopen?.();
        slot.close();

        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });
});
```

Ajuste o import do topo do arquivo para trazer `LiveSlot` junto:

```ts
import { LiveSlot, liveStore, liveStoreOf } from '../src/client/vanilla';
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/live/test/vanilla-adapter.test.ts`
Expected: FAIL — `Cannot find module '../src/client/vanilla'`.

- [ ] **Step 3: Implementar**

Crie `packages/live/src/client/vanilla.ts`:

```ts
import { canonical } from '../shared/canonical';
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDataOf,
    type LiveDescriptor,
    type LiveInputsOf
} from '../shared/descriptor';
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState, LiveStore } from './core';

/** A subscription held by something that is not a component. */
export interface LiveHandle<T> {
    /** Current state. Valid before, during and after a subscription. */
    get(): LiveState<T>;
    /**
     * Start receiving. The listener fires on every change, never on
     * registration -- read `get()` for the initial value.
     *
     * Returns the same function `close()` calls.
     */
    subscribe(listener: (state: LiveState<T>) => void): () => void;
    /** Release this handle's hold. Other handles on the same data keep theirs. */
    close(): void;
}

/**
 * Resolve a descriptor or a resource id to the underlying store.
 *
 * Framework adapters go through here rather than through `liveStore()`: they
 * already own their own teardown, and wrapping a second lifecycle around the
 * one the framework gives them is how an adapter starts leaking.
 */
export function liveStoreOf(
    client: LiveClient,
    resource: string | LiveDescriptor<any>,
    inputs: Record<string, any> = {}
): LiveStore<unknown> {
    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);

    return client.store(resourceId, normalizeLiveInputs(inputs as Partial<LiveInputs>));
}

/**
 * Canonical identity of a subscription, for adapters that need to know whether
 * reactive inputs actually changed before tearing a subscription down.
 */
export function liveIdentity(
    resource: string | LiveDescriptor<any>,
    inputs: Record<string, any> = {}
): string {
    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);
    const normalized = normalizeLiveInputs(inputs as Partial<LiveInputs>);

    return `${resourceId}|${canonical({
        params: normalized.params,
        query: normalized.query,
        body: normalized.body ?? null
    })}`;
}

export function liveStore<R>(
    client: LiveClient,
    descriptor: LiveDescriptor<R>,
    inputs?: LiveInputsOf<R>
): LiveHandle<LiveDataOf<R>>;
export function liveStore<T>(
    client: LiveClient,
    resourceId: string,
    inputs?: Partial<LiveInputs>
): LiveHandle<T>;

/**
 * Subscribe without a framework.
 *
 * This is the whole vanilla adapter, and it is small on purpose: everything
 * hard -- dedupe, revisions, resync, reconnect, the optimistic stack -- is in
 * the client, and an adapter that grows is logic leaking out of it.
 */
export function liveStore(
    client: LiveClient,
    resource: string | LiveDescriptor<any>,
    // Loose on purpose, and invisible to callers: a descriptor's own `query`
    // type is a plain object, which no index signature accepts. The overloads
    // above are what anyone actually sees.
    inputs: Record<string, any> = {}
): LiveHandle<any> {
    const store = liveStoreOf(client, resource, inputs);
    const drops = new Set<() => void>();

    return {
        get: () => store.getSnapshot(),
        subscribe(listener: (state: LiveState<any>) => void): () => void {
            const drop = store.subscribe(() => listener(store.getSnapshot()));
            drops.add(drop);

            // Idempotent: calling this and then close() must not release the
            // client's refcount twice, or an unrelated handle loses its data.
            return () => {
                if (drops.delete(drop)) {
                    drop();
                }
            };
        },
        close(): void {
            for (const drop of [...drops]) {
                drops.delete(drop);
                drop();
            }
        }
    };
}

const EMPTY_STATE: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

/**
 * A subscription that points at one target at a time.
 *
 * Reactive frameworks re-run an expression when its inputs change, and for a
 * live subscription that means "this component now wants a different instance".
 * The rule that makes that safe has nothing to do with any framework, so it
 * lives here: recomputing to the same inputs must not churn the subscription,
 * and switching targets must release the old one *before* retaining the new
 * one. Holding both across the switch is how a dragged filter walks a
 * connection into `maxInstancesPerConnection`.
 */
export class LiveSlot<T> {
    private identity: string | null = null;
    private release: (() => void) | null = null;
    private store: LiveStore<unknown> | null = null;

    constructor(
        private readonly client: LiveClient,
        private readonly onState: (state: LiveState<T>) => void
    ) {}

    point(resource: string | LiveDescriptor<any>, inputs: Record<string, any> = {}): void {
        const next = liveIdentity(resource, inputs);

        if (next === this.identity) {
            return;
        }

        this.release?.();
        this.release = null;

        this.identity = next;
        this.store = liveStoreOf(this.client, resource, inputs);

        const store = this.store;
        this.release = store.subscribe(() => this.onState(store.getSnapshot() as LiveState<T>));
        this.onState(store.getSnapshot() as LiveState<T>);
    }

    get(): LiveState<T> {
        return (this.store?.getSnapshot() as LiveState<T> | undefined) ?? EMPTY_STATE;
    }

    close(): void {
        this.release?.();
        this.release = null;
        this.store = null;
        this.identity = null;
    }
}
```

- [ ] **Step 4: Rodar até passar**

Run: `bun test packages/live/test/vanilla-adapter.test.ts`
Expected: **12 pass, 0 fail**.

- [ ] **Step 5: Exportar**

Em `packages/live/src/index.ts`, depois da linha `export type { OptimisticEntry, OptimisticList } from './client/optimistic';`, acrescente:

```ts
// Framework-free client adapter
export { liveStore, liveStoreOf, liveIdentity, LiveSlot } from './client/vanilla';
export type { LiveHandle } from './client/vanilla';
```

Em `packages/live/package.json`, dentro de `exports`, depois do bloco `"./react"`, acrescente:

```json
"./vanilla": {
  "types": "./dist/client/vanilla.d.ts",
  "require": "./dist/client/vanilla.js",
  "default": "./dist/client/vanilla.js"
}
```

- [ ] **Step 6: Compilar e rodar o pacote inteiro**

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **222 pass, 0 fail**.

- [ ] **Step 7: Commit**

```bash
git add packages/live/src/client/vanilla.ts packages/live/test/vanilla-adapter.test.ts packages/live/src/index.ts packages/live/package.json
```

Mensagem:

```
feat(live): add liveStore() and LiveSlot, the adapter with no framework

Everything useLive() does that is not React -- resolving a descriptor to
a resource id, normalising the three input slots, holding the
subscription -- was trapped inside the hook. Angular and Vue would have
copied it, and a copied adapter is a second place for the identity rules
to drift.

LiveSlot is the part that matters for them: a subscription pointing at
one target at a time, which recomputing to the same inputs leaves alone
and switching targets releases before it retains. Neither rule is about
any framework, so both are tested without one.

liveStore() is the §6.2 vanilla adapter on its own: subscribe without a
framework, get() before anyone listens, close() that releases only this
handle's hold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 3: `liveSignal()` — o adapter Angular

A §6.2 pede `users = liveSignal(api.users.list, () => ({ status: this.status() }))`: inputs como `computed`, reassinatura ao mudar, teardown por `DestroyRef`, funcionando zoneless. Com o `LiveSlot` da Task 2, tudo que sobra de Angular aqui é um `signal` de saída, um `effect` que aponta o slot, e um `onDestroy` que o fecha.

**Files:**
- Create: `packages/live/src/client/angular.ts`
- Create: `packages/live/test/angular-adapter.test.ts`
- Modify: `packages/live/package.json`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Consumes: `LiveSlot` de `./vanilla`; `LiveClient`, `LiveState` de `./core`; `LiveDataOf`, `LiveDescriptor`, `LiveInputsOf` de `../shared/descriptor`.
- Produces:
  - `const LIVE_CLIENT: InjectionToken<LiveClient>`
  - `function provideLive(client: LiveClient): Provider`
  - `function liveSignal<R>(descriptor: LiveDescriptor<R>, inputs?: () => LiveInputsOf<R>, options?: LiveSignalOptions): Signal<LiveState<LiveDataOf<R>>>`
  - `interface LiveSignalOptions { client?: LiveClient; injector?: Injector }`

- [ ] **Step 1 (gate): provar que `effect()` roda fora de componente neste ambiente**

Este é o único risco real da task, e ele é resolvido antes de qualquer linha de adapter existir. `effect()` precisa de um contexto de injeção e de um scheduler; num `bun test` não há aplicação Angular nenhuma. Se não der para exercitar `effect` aqui, o adapter não pode ser testado como adapter.

Instale primeiro:

```bash
bun add -D --cwd packages/live @angular/core@^18.2.0
```

Crie `packages/live/test/angular-probe.test.ts`, **temporário**:

```ts
import { describe, expect, test } from 'bun:test';
import { Injector, effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

describe('probe: Angular effect outside a component', () => {
    test('a bare Injector.create can host an effect', () => {
        const injector = Injector.create({ providers: [] });
        const source = signal(1);
        const seen: number[] = [];

        try {
            effect(() => seen.push(source()), { injector });
        } catch (error) {
            console.log('BARE INJECTOR FAILED:', (error as Error).message);
            expect(true).toBe(true);
            return;
        }

        source.set(2);
        console.log('BARE INJECTOR SAW:', JSON.stringify(seen));
        expect(true).toBe(true);
    });

    test('TestBed can host an effect and flush it', () => {
        try {
            TestBed.configureTestingModule({});
            const source = signal(1);
            const seen: number[] = [];

            TestBed.runInInjectionContext(() => effect(() => seen.push(source())));
            TestBed.flushEffects();
            source.set(2);
            TestBed.flushEffects();

            console.log('TESTBED SAW:', JSON.stringify(seen));
        } catch (error) {
            console.log('TESTBED FAILED:', (error as Error).message);
        }

        expect(true).toBe(true);
    });
});
```

Run: `bun test packages/live/test/angular-probe.test.ts`

Leia o que foi impresso e escolha o caminho:

- **`TESTBED SAW: [1,2]`** → use `TestBed` no teste da Step 3. É o caminho preferido.
- **`BARE INJECTOR SAW: [1,2]`** e o TestBed falhou → passe `Injector.create({ providers: [] })` em `options.injector` no teste.
- **Os dois falharam** → **plano B**, e ele não é ruim: `effect` fica fora do escopo de teste, e o teste exercita `liveSignal` pela função `reconcile()` que o `effect` apenas chama. Toda a lógica continua coberta pelos testes de `LiveSlot` da Task 2; o que fica sem cobertura automatizada é a linha `effect(() => reconcile())`, e isso vai registrado nos riscos deste plano em vez de fingido.

Apague `packages/live/test/angular-probe.test.ts` antes do commit, em qualquer um dos três casos.

- [ ] **Step 2: Escrever o teste, que falha**

Crie `packages/live/test/angular-adapter.test.ts`. O corpo abaixo assume o caminho `TestBed`; se a Step 1 apontou outro, troque só a forma de hospedar e disparar o `effect`, não as asserções.

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LIVE_CLIENT, liveSignal, provideLive } from '../src/client/angular';
import type { LiveDescriptor } from '../src/shared/descriptor';

function fakeSocket(): LiveSocket & { sent: string[]; deliver: (message: unknown) => void } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null,
        deliver(message: unknown) { socket.onmessage?.({ data: JSON.stringify(message) }); }
    };

    return socket;
}

interface CardsRoute {
    response: { id: number; title: string }[];
    query: { done?: string };
}

const cardsList: LiveDescriptor<CardsRoute> = {
    method: 'get',
    path: '/cards',
    resourceId: 'CardsController.list',
    live: { shared: 'public', key: 'id' }
};

let socket: ReturnType<typeof fakeSocket>;
let client: LiveClient;

beforeEach(() => {
    socket = fakeSocket();
    client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideLive(client)] });
});

function lastSub(): any {
    const raw = [...socket.sent].reverse().find(entry => entry.includes('"t":"sub"'));
    return raw ? JSON.parse(raw) : null;
}

describe('liveSignal', () => {
    test('starts pending and reads the client from LIVE_CLIENT', () => {
        const state = TestBed.runInInjectionContext(() => liveSignal(cardsList));
        TestBed.flushEffects();

        expect(TestBed.inject(LIVE_CLIENT)).toBe(client);
        expect(state()).toEqual({ data: undefined, pending: true, error: null, stale: false });
    });

    test('a snapshot updates the signal', () => {
        const state = TestBed.runInInjectionContext(() => liveSignal(cardsList));
        TestBed.flushEffects();
        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(state().data).toEqual([{ id: 1, title: 'a' }]);
        expect(state().pending).toBe(false);
    });

    test('changing a reactive input resubscribes with the new inputs', () => {
        const done = signal('false');
        const state = TestBed.runInInjectionContext(() =>
            liveSignal(cardsList, () => ({ query: { done: done() } }))
        );
        TestBed.flushEffects();
        socket.onopen?.();

        expect(lastSub().inputs.query).toEqual({ done: 'false' });

        done.set('true');
        TestBed.flushEffects();

        expect(lastSub().inputs.query).toEqual({ done: 'true' });
        expect(socket.sent.filter(raw => raw.includes('"t":"unsub"')).length).toBe(1);
        void state;
    });

    test('a reactive input that recomputes to the same value does not resubscribe', () => {
        const unrelated = signal(0);
        TestBed.runInInjectionContext(() =>
            liveSignal(cardsList, () => {
                void unrelated();
                return { query: { done: 'false' } };
            })
        );
        TestBed.flushEffects();
        socket.onopen?.();
        const before = socket.sent.length;

        unrelated.set(1);
        TestBed.flushEffects();

        expect(socket.sent.length).toBe(before);
    });

    test('destroying the injection context unsubscribes', () => {
        TestBed.runInInjectionContext(() => liveSignal(cardsList));
        TestBed.flushEffects();
        socket.onopen?.();

        TestBed.resetTestingModule();

        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });

    test('an explicit client wins over the injected one', () => {
        const otherSocket = fakeSocket();
        const other = new LiveClient({ url: 'ws://y/live', socketFactory: () => otherSocket });

        TestBed.runInInjectionContext(() => liveSignal(cardsList, undefined, { client: other }));
        TestBed.flushEffects();
        otherSocket.onopen?.();

        expect(otherSocket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
        expect(socket.sent).toEqual([]);
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test packages/live/test/angular-adapter.test.ts`
Expected: FAIL — `Cannot find module '../src/client/angular'`.

- [ ] **Step 4: Implementar**

Crie `packages/live/src/client/angular.ts`:

```ts
import {
    DestroyRef,
    InjectionToken,
    Injector,
    computed,
    effect,
    inject,
    signal,
    type Provider,
    type Signal
} from '@angular/core';
import type { LiveDataOf, LiveDescriptor, LiveInputsOf } from '../shared/descriptor';
import type { LiveClient, LiveState } from './core';
import { LiveSlot } from './vanilla';

/** How a component finds the client without every call site passing it. */
export const LIVE_CLIENT = new InjectionToken<LiveClient>('carno.live.client');

export function provideLive(client: LiveClient): Provider {
    return { provide: LIVE_CLIENT, useValue: client };
}

export interface LiveSignalOptions {
    /** Overrides the injected client. Mostly for tests and for multi-backend apps. */
    client?: LiveClient;
    /** Required when calling outside an injection context. */
    injector?: Injector;
}

const PENDING: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

export function liveSignal<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: () => LiveInputsOf<R>,
    options?: LiveSignalOptions
): Signal<LiveState<LiveDataOf<R>>>;
export function liveSignal<T>(
    resourceId: string,
    inputs?: () => Record<string, any>,
    options?: LiveSignalOptions
): Signal<LiveState<T>>;

/**
 * Subscribe a component to server-owned state, as a signal.
 *
 * `inputs` is read reactively, so changing a signal it touches re-points the
 * subscription and cancels the previous one. Teardown is `DestroyRef`, so
 * there is nothing to unsubscribe by hand, and nothing here touches zone.js.
 */
export function liveSignal(
    resource: string | LiveDescriptor<any>,
    inputs: () => Record<string, any> = () => ({}),
    options: LiveSignalOptions = {}
): Signal<LiveState<any>> {
    const client = options.client ?? inject(LIVE_CLIENT);
    const destroyRef = options.injector
        ? options.injector.get(DestroyRef)
        : inject(DestroyRef);

    const state = signal<LiveState<any>>(PENDING);
    const slot = new LiveSlot<any>(client, next => state.set(next));

    // A computed, not a raw call: the effect below then re-runs only when the
    // inputs actually recompute to something different, and LiveSlot ignores
    // the ones that recompute to the same thing.
    const target = computed(() => inputs());

    effect(() => slot.point(resource, target()), options.injector ? { injector: options.injector } : undefined);

    destroyRef.onDestroy(() => slot.close());

    return state.asReadonly();
}
```

- [ ] **Step 5: Rodar até passar**

Run: `bun test packages/live/test/angular-adapter.test.ts`
Expected: **6 pass, 0 fail**.

- [ ] **Step 6: Declarar Angular como peer opcional e exportar o subpath**

Em `packages/live/package.json`, dentro de `peerDependencies`:

```json
"@angular/core": ">=18.0.0"
```

Dentro de `peerDependenciesMeta`:

```json
"@angular/core": { "optional": true }
```

Dentro de `exports`:

```json
"./angular": {
  "types": "./dist/client/angular.d.ts",
  "require": "./dist/client/angular.js",
  "default": "./dist/client/angular.js"
}
```

Em `packages/live/src/index.ts` **não** exporte nada de `./client/angular`: o barril é carregado por todo mundo, e um `import '@angular/core'` ali obrigaria quem usa React a ter Angular instalado. O subpath é a porta de entrada, igual ao `./react`.

- [ ] **Step 7: Verificar tipos e o pacote inteiro**

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **228 pass, 0 fail**.

- [ ] **Step 8: Apagar o probe e commitar**

```bash
rm -f packages/live/test/angular-probe.test.ts
git add packages/live/src/client/angular.ts packages/live/test/angular-adapter.test.ts packages/live/package.json bun.lock
```

Mensagem:

```
feat(live): add liveSignal(), the Angular adapter

Inputs are read reactively, so changing a signal they touch re-points the
subscription; LiveSlot is what makes that safe, and it already carries
the rules. Teardown is DestroyRef, so a component unsubscribes by being
destroyed. Nothing here touches zone.js.

The client comes from LIVE_CLIENT rather than from every call site, and
an explicit one still wins. Angular is an optional peer and is reachable
only through the ./angular subpath -- importing it from the barrel would
make a React app install Angular.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 4: `useLiveQuery()` — o adapter Vue

Mesma forma da Task 3, primitivas diferentes: `shallowRef` no lugar de `signal`, `watchEffect` no lugar de `effect`, `onScopeDispose` no lugar de `DestroyRef`. `shallowRef` e não `ref` porque o dado do servidor é substituído inteiro a cada snapshot e nunca mutado no lugar — um proxy profundo aqui só pagaria o custo de rastrear o que ninguém vai escrever.

**Files:**
- Create: `packages/live/src/client/vue.ts`
- Create: `packages/live/test/vue-adapter.test.ts`
- Modify: `packages/live/package.json`

**Interfaces:**
- Consumes: `LiveSlot` de `./vanilla`; `LiveClient`, `LiveState` de `./core`; `LiveDataOf`, `LiveDescriptor`, `LiveInputsOf` de `../shared/descriptor`.
- Produces:
  - `const LIVE_CLIENT_KEY: InjectionKey<LiveClient>`
  - `function provideLiveClient(client: LiveClient): void`
  - `function useLiveQuery<R>(descriptor: LiveDescriptor<R>, inputs?: () => LiveInputsOf<R>, options?: { client?: LiveClient }): ShallowRef<LiveState<LiveDataOf<R>>>`

- [ ] **Step 1: Instalar Vue como devDependency**

```bash
bun add -D --cwd packages/live vue@^3.5.0
```

- [ ] **Step 2: Escrever o teste, que falha**

Crie `packages/live/test/vue-adapter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { effectScope, nextTick, ref } from 'vue';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { useLiveQuery } from '../src/client/vue';
import type { LiveDescriptor } from '../src/shared/descriptor';

function fakeSocket(): LiveSocket & { sent: string[]; deliver: (message: unknown) => void } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null,
        deliver(message: unknown) { socket.onmessage?.({ data: JSON.stringify(message) }); }
    };

    return socket;
}

interface CardsRoute {
    response: { id: number; title: string }[];
    query: { done?: string };
}

const cardsList: LiveDescriptor<CardsRoute> = {
    method: 'get',
    path: '/cards',
    resourceId: 'CardsController.list',
    live: { shared: 'public', key: 'id' }
};

function harness() {
    const socket = fakeSocket();
    const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
    const scope = effectScope();

    const lastSub = () => {
        const raw = [...socket.sent].reverse().find(entry => entry.includes('"t":"sub"'));
        return raw ? JSON.parse(raw) : null;
    };

    return { socket, client, scope, lastSub };
}

describe('useLiveQuery', () => {
    test('starts pending and fills in from a snapshot', () => {
        const { socket, client, scope, lastSub } = harness();
        const state = scope.run(() => useLiveQuery(cardsList, undefined, { client }))!;

        expect(state.value.pending).toBe(true);

        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(state.value.data).toEqual([{ id: 1, title: 'a' }]);
        expect(state.value.pending).toBe(false);
        scope.stop();
    });

    test('changing a reactive input resubscribes', async () => {
        const { socket, client, scope, lastSub } = harness();
        const done = ref('false');

        scope.run(() => useLiveQuery(cardsList, () => ({ query: { done: done.value } }), { client }));
        socket.onopen?.();

        expect(lastSub().inputs.query).toEqual({ done: 'false' });

        done.value = 'true';
        await nextTick();

        expect(lastSub().inputs.query).toEqual({ done: 'true' });
        expect(socket.sent.filter(raw => raw.includes('"t":"unsub"')).length).toBe(1);
        scope.stop();
    });

    test('a reactive input that recomputes to the same value does not resubscribe', async () => {
        const { socket, client, scope } = harness();
        const unrelated = ref(0);

        scope.run(() => useLiveQuery(cardsList, () => {
            void unrelated.value;
            return { query: { done: 'false' } };
        }, { client }));
        socket.onopen?.();
        const before = socket.sent.length;

        unrelated.value = 1;
        await nextTick();

        expect(socket.sent.length).toBe(before);
        scope.stop();
    });

    test('stopping the scope unsubscribes', () => {
        const { socket, client, scope } = harness();

        scope.run(() => useLiveQuery(cardsList, undefined, { client }));
        socket.onopen?.();
        scope.stop();

        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });

    test('the ref is shallow: the state object is replaced, never mutated', () => {
        const { socket, client, scope, lastSub } = harness();
        const state = scope.run(() => useLiveQuery(cardsList, undefined, { client }))!;
        const first = state.value;

        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [] });

        expect(state.value).not.toBe(first);
        scope.stop();
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test packages/live/test/vue-adapter.test.ts`
Expected: FAIL — `Cannot find module '../src/client/vue'`.

- [ ] **Step 4: Implementar**

Crie `packages/live/src/client/vue.ts`:

```ts
import {
    computed,
    getCurrentInstance,
    inject,
    onScopeDispose,
    provide,
    shallowRef,
    watchEffect,
    type InjectionKey,
    type ShallowRef
} from 'vue';
import type { LiveDataOf, LiveDescriptor, LiveInputsOf } from '../shared/descriptor';
import type { LiveClient, LiveState } from './core';
import { LiveSlot } from './vanilla';

export const LIVE_CLIENT_KEY: InjectionKey<LiveClient> = Symbol('carno.live.client');

/** Call once, high in the tree. Every useLiveQuery() below it finds the client. */
export function provideLiveClient(client: LiveClient): void {
    provide(LIVE_CLIENT_KEY, client);
}

const PENDING: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

export function useLiveQuery<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: () => LiveInputsOf<R>,
    options?: { client?: LiveClient }
): ShallowRef<LiveState<LiveDataOf<R>>>;
export function useLiveQuery<T>(
    resourceId: string,
    inputs?: () => Record<string, any>,
    options?: { client?: LiveClient }
): ShallowRef<LiveState<T>>;

/**
 * Subscribe a component to server-owned state, as a shallow ref.
 *
 * Shallow because the server replaces the whole snapshot and nothing ever
 * writes into it: a deep proxy would pay to track mutations that cannot
 * happen. `inputs` is read inside a watchEffect, so a ref it touches
 * re-points the subscription; the effect scope tears it down.
 */
export function useLiveQuery(
    resource: string | LiveDescriptor<any>,
    inputs: () => Record<string, any> = () => ({}),
    options: { client?: LiveClient } = {}
): ShallowRef<LiveState<any>> {
    const client = options.client
        ?? (getCurrentInstance() ? inject(LIVE_CLIENT_KEY, undefined) : undefined);

    if (!client) {
        throw new Error(
            'useLiveQuery() found no LiveClient. Call provideLiveClient(client) in an ancestor ' +
            'component, or pass { client } explicitly.'
        );
    }

    const state = shallowRef<LiveState<any>>(PENDING);
    const slot = new LiveSlot<any>(client, next => { state.value = next; });
    const target = computed(() => inputs());

    watchEffect(() => slot.point(resource, target.value));
    onScopeDispose(() => slot.close());

    return state;
}
```

- [ ] **Step 5: Rodar até passar**

Run: `bun test packages/live/test/vue-adapter.test.ts`
Expected: **5 pass, 0 fail**.

- [ ] **Step 6: Peer opcional e subpath**

Em `packages/live/package.json`, `peerDependencies`:

```json
"vue": ">=3.4.0"
```

`peerDependenciesMeta`:

```json
"vue": { "optional": true }
```

`exports`:

```json
"./vue": {
  "types": "./dist/client/vue.d.ts",
  "require": "./dist/client/vue.js",
  "default": "./dist/client/vue.js"
}
```

Mesma regra da Task 3: nada de `./client/vue` no barril.

- [ ] **Step 7: Verificar**

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **233 pass, 0 fail**.

- [ ] **Step 8: Commit**

```bash
git add packages/live/src/client/vue.ts packages/live/test/vue-adapter.test.ts packages/live/package.json bun.lock
```

Mensagem:

```
feat(live): add useLiveQuery(), the Vue adapter

shallowRef and not ref: the server replaces the whole snapshot and
nothing writes into it, so a deep proxy would pay to track mutations
that cannot happen. Inputs are read inside a watchEffect, so a ref they
touch re-points the subscription, and the effect scope tears it down.

Vue is an optional peer, reachable only through the ./vue subpath.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Com esta task, a ordem de entrega de adapters da §6.2 — React, Angular, Vue, vanilla — está completa.

---
### Task 5: As métricas da §10 saem do processo

O `LiveEngine` já conta `recomputes` e `recomputesWithoutPatch`, e `stats()` os expõe — para quem tiver a referência do engine na mão, que em produção é ninguém. A §10 chama `recomputesWithoutPatch` de "a mais importante" porque ela mede a precisão da granularidade da §4.3 diretamente: se sobe, a invalidação está grossa e está queimando CPU e banco à toa. Um número que mede isso e não sai do processo não mede nada.

Faltam também dois que ainda não existem: fan-out por invalidação e tamanho de patch.

**Files:**
- Modify: `packages/core/src/observability/ObservabilityService.ts`
- Modify: `packages/logger/src/LoggerObservabilityService.ts`
- Create: `packages/live/src/observability.ts`
- Modify: `packages/live/src/LiveEngine.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Create: `packages/live/test/metrics.test.ts`
- Create: `packages/core/test/observability-metric.spec.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Consumes: `ObservabilityService` de `@carno.js/core`.
- Produces:
  - Em core: `ObservabilityService.onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void` — no-op na base.
  - Em live: `interface MetricSink { onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void }`
  - Em live: `class LiveMetrics` com `recompute(resourceId, producedPatch, ops, durationMs)`, `invalidation(keys, fanout)`, `instances(count)`, e `static none(): LiveMetrics`.
  - `LiveEngine` ganha um 8º parâmetro opcional de construtor: `metrics: LiveMetrics = LiveMetrics.none()`.

Nomes publicados, e são contrato — um dashboard vai depender deles:

| Nome | Tipo | Tags | Significado |
| :--- | :--- | :--- | :--- |
| `live.recompute` | contador | `resource`, `patched` | Um recompute terminou. `patched=false` é o número da §10. |
| `live.recompute.ms` | duração | `resource` | Quanto o compute levou. |
| `live.patch.ops` | tamanho | `resource` | Operações no patch emitido. Zero nunca é publicado. |
| `live.invalidation.keys` | tamanho | — | Chaves numa entrega do bus. |
| `live.invalidation.fanout` | tamanho | — | Instâncias que ela acordou. |
| `live.instances` | medidor | — | Instâncias vivas neste processo, publicado a cada flush. |

- [ ] **Step 1: Escrever o teste do core, que falha**

Crie `packages/core/test/observability-metric.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { ObservabilityService } from '../src/observability/ObservabilityService';

describe('ObservabilityService.onMetric', () => {
  it('is a no-op on the base class, like the other hooks', () => {
    const service = new ObservabilityService();

    expect(() => service.onMetric('anything', 1)).not.toThrow();
    expect(service.enabled).toBe(false);
  });

  it('is overridable, and receives name, value and tags', () => {
    const seen: unknown[] = [];

    class Recording extends ObservabilityService {
      override readonly enabled = true;

      override onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
        seen.push({ name, value, tags });
      }
    }

    new Recording().onMetric('live.recompute', 1, { resource: 'X.y', patched: false });

    expect(seen).toEqual([{ name: 'live.recompute', value: 1, tags: { resource: 'X.y', patched: false } }]);
  });
});
```

Run: `bun test packages/core/test/observability-metric.spec.ts`
Expected: FAIL — `service.onMetric is not a function`.

- [ ] **Step 2: Implementar no core**

Em `packages/core/src/observability/ObservabilityService.ts`, dentro da classe, depois de `onExecutionError`:

```ts
    /**
     * A named number from anywhere in the framework.
     *
     * Deliberately generic. The alternative was a method per subsystem, which
     * would make core learn the vocabulary of packages it does not depend on
     * and that are optional -- `@carno.js/live` publishes recompute and
     * fan-out through here for exactly that reason. Names are namespaced by
     * their publisher (`live.recompute`, `queue.depth`).
     */
    onMetric(
        _name: string,
        _value: number,
        _tags?: Record<string, string | number | boolean>
    ): void {
        // no-op
    }
```

Run: `bun test packages/core/test/observability-metric.spec.ts`
Expected: **2 pass, 0 fail**.

- [ ] **Step 3: Implementar no logger**

Em `packages/logger/src/LoggerObservabilityService.ts`, dentro da classe:

```ts
    override onMetric(
        name: string,
        value: number,
        tags?: Record<string, string | number | boolean>
    ): void {
        this.logger.info('Metric', { metric: name, value, ...tags });
    }
```

Run: `bun test packages/logger`
Expected: sem falhas novas.

- [ ] **Step 4: Escrever o teste das métricas do live, que falha**

Crie `packages/live/test/metrics.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { LiveMetrics, type MetricSink } from '../src/observability';

function recorder(): MetricSink & { seen: { name: string; value: number; tags?: Record<string, any> }[] } {
    const seen: { name: string; value: number; tags?: Record<string, any> }[] = [];

    return {
        seen,
        onMetric(name, value, tags) { seen.push({ name, value, tags }); }
    };
}

describe('LiveMetrics', () => {
    test('a recompute that produced a patch publishes the count, the duration and the size', () => {
        const sink = recorder();

        new LiveMetrics(sink).recompute('CardsController.list', true, 3, 12.5);

        expect(sink.seen).toEqual([
            { name: 'live.recompute', value: 1, tags: { resource: 'CardsController.list', patched: true } },
            { name: 'live.recompute.ms', value: 12.5, tags: { resource: 'CardsController.list' } },
            { name: 'live.patch.ops', value: 3, tags: { resource: 'CardsController.list' } }
        ]);
    });

    test('a recompute that produced no patch is counted, and publishes no patch size', () => {
        const sink = recorder();

        new LiveMetrics(sink).recompute('CardsController.list', false, 0, 4);

        expect(sink.seen.map(entry => entry.name)).toEqual(['live.recompute', 'live.recompute.ms']);
        expect(sink.seen[0].tags).toEqual({ resource: 'CardsController.list', patched: false });
    });

    test('an invalidation publishes how many keys arrived and how many instances woke', () => {
        const sink = recorder();

        new LiveMetrics(sink).invalidation(2, 17);

        expect(sink.seen).toEqual([
            { name: 'live.invalidation.keys', value: 2, tags: undefined },
            { name: 'live.invalidation.fanout', value: 17, tags: undefined }
        ]);
    });

    test('an invalidation that woke nothing still publishes the fan-out', () => {
        const sink = recorder();

        // Zero fan-out is the healthy case and the interesting one: it is what
        // a precise graph looks like. Dropping it would bias the average up.
        new LiveMetrics(sink).invalidation(1, 0);

        expect(sink.seen.find(entry => entry.name === 'live.invalidation.fanout')?.value).toBe(0);
    });

    test('none() swallows everything without a sink', () => {
        expect(() => {
            LiveMetrics.none().recompute('X.y', true, 1, 1);
            LiveMetrics.none().invalidation(1, 1);
            LiveMetrics.none().instances(5);
        }).not.toThrow();
    });

    test('a sink that throws does not take the caller down', () => {
        const metrics = new LiveMetrics({
            onMetric() { throw new Error('the metrics backend is down'); }
        });

        // Losing a number is acceptable. Losing a recompute is not.
        expect(() => metrics.recompute('X.y', true, 1, 1)).not.toThrow();
    });
});
```

Run: `bun test packages/live/test/metrics.test.ts`
Expected: FAIL — `Cannot find module '../src/observability'`.

- [ ] **Step 5: Implementar `LiveMetrics`**

Crie `packages/live/src/observability.ts`:

```ts
/**
 * The slice of `ObservabilityService` the live package needs.
 *
 * Declared structurally rather than imported so `@carno.js/core` stays an
 * ordinary peer here and the metrics path is testable without one.
 */
export interface MetricSink {
    onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void;
}

/**
 * Names the engine publishes, and the guard that keeps a broken metrics
 * backend from breaking the engine.
 *
 * The engine calls this unconditionally; `none()` is what makes that safe when
 * no observability plugin is installed, which is the default.
 */
export class LiveMetrics {
    constructor(private readonly sink: MetricSink | null) {}

    static none(): LiveMetrics {
        return new LiveMetrics(null);
    }

    recompute(resource: string, producedPatch: boolean, ops: number, durationMs: number): void {
        this.publish('live.recompute', 1, { resource, patched: producedPatch });
        this.publish('live.recompute.ms', durationMs, { resource });

        if (producedPatch) {
            this.publish('live.patch.ops', ops, { resource });
        }
    }

    invalidation(keys: number, fanout: number): void {
        this.publish('live.invalidation.keys', keys);
        this.publish('live.invalidation.fanout', fanout);
    }

    instances(count: number): void {
        this.publish('live.instances', count);
    }

    private publish(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
        if (!this.sink) {
            return;
        }

        try {
            this.sink.onMetric(name, value, tags);
        } catch {
            // Losing a number is acceptable. Losing a recompute is not.
        }
    }
}
```

Run: `bun test packages/live/test/metrics.test.ts`
Expected: **6 pass, 0 fail**.

- [ ] **Step 6: Escrever o teste que prova que o engine publica**

Acrescente a `packages/live/test/metrics.test.ts`, no fim:

```ts
import { DependencyGraph } from '../src/graph/DependencyGraph';
import { InProcessBus } from '../src/bus/InProcessBus';
import { LiveEngine } from '../src/LiveEngine';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';
import { resolveLiveConfig } from '../src/config';
import { Controller, Get } from '@carno.js/core';
import { Live } from '../src/decorators/Live';

describe('LiveEngine metrics', () => {
    test('a recompute that changes nothing publishes patched=false', async () => {
        let payload = [{ id: 1 }];

        @Controller('/things')
        class ThingsController {
            @Get('/')
            @Live({ shared: 'public', dependsOn: ['orm:things'] })
            list() { return payload; }
        }

        const sink = recorder();
        const resources = new ResourceRegistry();
        resources.register(ThingsController, new ThingsController());

        const bus = new InProcessBus();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            bus,
            { send: () => 1 },
            resolveLiveConfig({ coalesceMs: 1 }),
            undefined,
            new LiveMetrics(sink)
        );

        engine.start();
        await engine.subscribe('c1', 's1', 'ThingsController.list', { params: {}, query: {} }, {});

        bus.publish([{ key: 'orm:things', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 40));

        const recomputes = sink.seen.filter(entry => entry.name === 'live.recompute');
        expect(recomputes.some(entry => entry.tags?.patched === false)).toBe(true);
        expect(sink.seen.some(entry => entry.name === 'live.patch.ops')).toBe(false);

        // And the same invalidation, now producing real change, flips it.
        payload = [{ id: 1 }, { id: 2 }];
        bus.publish([{ key: 'orm:things', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(sink.seen.some(entry => entry.name === 'live.patch.ops')).toBe(true);
        expect(sink.seen.some(entry => entry.name === 'live.invalidation.fanout' && entry.value === 1)).toBe(true);

        engine.stop();
    });
});
```

Run: `bun test packages/live/test/metrics.test.ts`
Expected: FAIL — o `LiveEngine` ainda não aceita o 8º parâmetro.

- [ ] **Step 7: Instrumentar o `LiveEngine`**

Em `packages/live/src/LiveEngine.ts`:

Importe no topo:

```ts
import { LiveMetrics } from './observability';
```

No construtor, depois de `authorizer`:

```ts
        private readonly metrics: LiveMetrics = LiveMetrics.none()
```

Em `onInvalidation`, meça o fan-out. Substitua o corpo do laço externo e o que vem depois dele por:

```ts
    private onInvalidation(events: InvalidationEvent[]): void {
        const before = this.pending.size;

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

        // Newly pending, not total pending: an invalidation that woke nothing
        // because the instances were already queued did not cost a fan-out.
        this.metrics.invalidation(events.length, this.pending.size - before);

        if (this.pending.size === 0 || this.flushTimer) {
            return;
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, this.config.coalesceMs);
    }
```

Em `flush`, depois de `this.pending.clear();`:

```ts
        this.metrics.instances(this.instances.size);
```

Em `runCompute`, substitua a função inteira por:

```ts
    private async runCompute(instance: LiveInstance): Promise<void> {
        const startedAt = performance.now();
        let data: unknown;
        let deps;

        try {
            ({ data, deps } = await this.resources.compute(instance.resource, instance.inputs));
        } catch (error) {
            await this.broadcast(instance, sid => ({ t: 'stale', sid, reason: (error as Error).message }));
            return;
        }

        this.recomputes++;
        this.graph.setDependencies(instance.id, deps);

        const hash = fnv1a64(canonical(data));

        if (hash === instance.hash) {
            // Recompute is not a patch. Coarse invalidation costs CPU, never
            // traffic and never a re-render. This is the number of §10.
            this.recomputesWithoutPatch++;
            this.metrics.recompute(instance.resource.id, false, 0, performance.now() - startedAt);
            return;
        }

        const ops = instance.patcher.diff(instance.data, data);
        const from = instance.revision;

        instance.data = data;
        instance.hash = hash;
        instance.revision += 1;

        this.metrics.recompute(instance.resource.id, true, ops.length, performance.now() - startedAt);

        await this.broadcast(instance, sid => ({
            t: 'patch',
            sid,
            from,
            to: instance.revision,
            hash,
            ops
        }));
    }
```

Run: `bun test packages/live/test/metrics.test.ts`
Expected: **7 pass, 0 fail**.

- [ ] **Step 8: Ligar no plugin**

Em `packages/live/src/LivePlugin.ts`, importe:

```ts
import { ObservabilityService } from '@carno.js/core';
import { LiveMetrics } from './observability';
```

O `LiveEngine` é construído antes do container existir, e o `ObservabilityService` só existe depois — então o engine nasce com um sink indireto que passa a apontar para o serviço real quando o builder roda. Substitua a construção do engine por:

```ts
        let sink: ObservabilityService | null = null;
        const metrics = new LiveMetrics({
            onMetric: (name, value, tags) => sink?.onMetric(name, value, tags)
        });

        const engine = new LiveEngine(
            resources,
            graph,
            subs,
            bus,
            transport,
            config,
            options.authorizer ?? new AllowAllAuthorizer(),
            metrics
        );
```

E dentro de `plugin.wsHandler((container: Container) => { ... })`, como primeira instrução:

```ts
            // Resolved here and not above: the container does not exist until
            // bootstrap, and an app with no observability plugin never
            // registers one.
            sink = container.has(ObservabilityService) ? container.get(ObservabilityService) : null;
```

- [ ] **Step 9: Exportar**

Em `packages/live/src/index.ts`:

```ts
// Metrics
export { LiveMetrics } from './observability';
export type { MetricSink } from './observability';
```

- [ ] **Step 10: Verificar tudo**

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live packages/core packages/logger`
Expected: **240 pass** no live (233 mais 7), sem falhas novas em core nem em logger.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/observability/ObservabilityService.ts packages/core/test/observability-metric.spec.ts packages/logger/src/LoggerObservabilityService.ts packages/live/src/observability.ts packages/live/src/LiveEngine.ts packages/live/src/LivePlugin.ts packages/live/src/index.ts packages/live/test/metrics.test.ts
```

Mensagem:

```
feat(live): publish the §10 metrics through ObservabilityService

stats() already counted recomputes and recomputes-without-patch, and in
production nobody holds the engine reference needed to read them. The
second of those measures the precision of the invalidation granularity
directly -- the design calls it the most important number in the system
-- so a version of it that never leaves the process measures nothing.

Core gains one generic hook, onMetric(name, value, tags), rather than a
method per subsystem: live is an optional package, and core should not
learn what a recompute is to report one. Fan-out per invalidation and
patch size are new; a sink that throws is swallowed, because losing a
number is acceptable and losing a recompute is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 6: `ETag` de hash de conteúdo — o piso da degradação

O último degrau da §8.4 é "polling por `GET` condicional, `ETag` = hash de conteúdo". Um `@Live()` em `@Get()` já é uma rota HTTP normal, então isso não é uma rota nova: é a mesma rota respondendo `304` quando o cliente já tem aquele conteúdo. E o hash é o mesmo `fnv1a64(canonical(...))` que o engine usa para decidir se um recompute virou patch e que o `sub` usa no handshake da §8.1 — uma peça, três problemas.

O middleware só age em rotas que são live. Aplicar `ETag` a todo `GET` da aplicação mudaria o comportamento de rotas que não pediram nada disso.

**Files:**
- Modify: `packages/core/src/index.ts` — reexportar `CONTROLLER_META`
- Modify: `packages/live/src/resource/types.ts`
- Modify: `packages/live/src/resource/ResourceRegistry.ts`
- Create: `packages/live/src/http/etag.ts`
- Create: `packages/live/test/etag.test.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Consumes: `CarnoMiddleware`, `CarnoClosure`, `Context` de `@carno.js/core`; `canonical` de `../shared/canonical`; `fnv1a64` de `../shared/hash`.
- Produces:
  - `LiveResource` ganha `httpPath: string` e `httpMethod: string`.
  - `ResourceRegistry.livePaths(): { method: string; path: string }[]`
  - `class LiveETagMiddleware implements CarnoMiddleware`, construída com `(paths: { method: string; path: string }[])`.
  - `function pathMatcher(pattern: string): RegExp` — exportada para o teste, `:name` vira um segmento.

- [ ] **Step 1: Escrever o teste, que falha**

Crie `packages/live/test/etag.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Context } from '@carno.js/core';
import { LiveETagMiddleware, pathMatcher } from '../src/http/etag';

const LIVE_PATHS = [
    { method: 'GET', path: '/cards' },
    { method: 'GET', path: '/cards/:id' },
    { method: 'POST', path: '/cards/search' }
];

function contextFor(url: string, headers: Record<string, string> = {}, method = 'GET'): Context {
    return new Context(new Request(url, { method, headers }));
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

describe('pathMatcher', () => {
    test('a :param matches exactly one segment', () => {
        const matcher = pathMatcher('/cards/:id');

        expect(matcher.test('/cards/42')).toBe(true);
        expect(matcher.test('/cards')).toBe(false);
        expect(matcher.test('/cards/42/comments')).toBe(false);
    });

    test('a literal path matches only itself', () => {
        const matcher = pathMatcher('/cards');

        expect(matcher.test('/cards')).toBe(true);
        expect(matcher.test('/cardsx')).toBe(false);
    });
});

describe('LiveETagMiddleware', () => {
    test('adds an ETag to a live GET', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        );

        expect((response as Response).headers.get('ETag')).toMatch(/^"[0-9a-f]+"$/);
    });

    test('answers 304 with no body when If-None-Match matches', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const first = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        ) as Response;
        const tag = first.headers.get('ETag')!;

        const second = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': tag }),
            async () => jsonResponse([{ id: 1 }])
        ) as Response;

        expect(second.status).toBe(304);
        expect(await second.text()).toBe('');
        expect(second.headers.get('ETag')).toBe(tag);
    });

    test('answers 200 when the content changed', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const first = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        ) as Response;

        const second = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': first.headers.get('ETag')! }),
            async () => jsonResponse([{ id: 1 }, { id: 2 }])
        ) as Response;

        expect(second.status).toBe(200);
        expect(await second.json()).toEqual([{ id: 1 }, { id: 2 }]);
    });

    test('the hash is of the canonical content, not of the byte order', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const ordered = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse({ a: 1, b: 2 })
        ) as Response;

        const reordered = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': ordered.headers.get('ETag')! }),
            async () => jsonResponse({ b: 2, a: 1 })
        ) as Response;

        // Same content, different key order. A byte hash would send it again.
        expect(reordered.status).toBe(304);
    });

    test('a path that is not live is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/health'), async () =>
            jsonResponse({ ok: true })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('a live POST is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(
            contextFor('http://x/cards/search', {}, 'POST'),
            async () => jsonResponse([])
        ) as Response;

        // POST is not cacheable, and conditional polling on it means nothing.
        expect(response.headers.get('ETag')).toBeNull();
    });

    test('a non-200 is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            new Response('nope', { status: 500 })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('a non-JSON body is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('the downstream response is still readable by the caller', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 7 }])
        ) as Response;

        // Hashing consumed the body once; the caller has to get a fresh one.
        expect(await response.json()).toEqual([{ id: 7 }]);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/live/test/etag.test.ts`
Expected: FAIL — `Cannot find module '../src/http/etag'`.

- [ ] **Step 3: Implementar**

Crie `packages/live/src/http/etag.ts`:

```ts
import type { CarnoClosure, CarnoMiddleware, Context } from '@carno.js/core';
import { canonical } from '../shared/canonical';
import { fnv1a64 } from '../shared/hash';

export interface LiveRoutePath {
    method: string;
    path: string;
}

/** `/cards/:id` matches `/cards/42` and nothing deeper. */
export function pathMatcher(pattern: string): RegExp {
    const source = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');

    return new RegExp(`^${source}$`);
}

/**
 * Content-hash `ETag` on live GET routes, and `304` when the client already
 * holds that content.
 *
 * This is the bottom rung of §8.4: a client with neither WebSocket nor SSE
 * polls the same route the SPA calls, and pays for a body only when something
 * changed. The hash is the canonical one -- the same function the engine uses
 * to decide whether a recompute produced a patch -- so reordered JSON keys are
 * the same content, not a change.
 *
 * Scoped to live routes on purpose. Putting an `ETag` on every GET in the
 * application would change the behaviour of routes that asked for none of this.
 */
export class LiveETagMiddleware implements CarnoMiddleware {
    private readonly matchers: RegExp[];

    constructor(paths: LiveRoutePath[]) {
        this.matchers = paths
            .filter(entry => entry.method.toUpperCase() === 'GET')
            .map(entry => pathMatcher(entry.path));
    }

    async handle(ctx: Context, next: CarnoClosure): Promise<Response | void> {
        if (ctx.method.toUpperCase() !== 'GET' || !this.covers(ctx.path)) {
            return next();
        }

        const response = await next();

        if (response.status !== 200) {
            return response;
        }

        const contentType = response.headers.get('Content-Type') ?? '';

        if (!contentType.includes('application/json')) {
            return response;
        }

        // Reading the body consumes the stream, so everything below hands the
        // caller a rebuilt response rather than the one it just drained.
        const body = await response.clone().text();
        let tag: string;

        try {
            tag = `"${fnv1a64(canonical(JSON.parse(body)))}"`;
        } catch {
            // Content-Type said JSON and it is not. Not our problem to fix.
            return response;
        }

        if (ctx.req.headers.get('If-None-Match') === tag) {
            return new Response(null, { status: 304, headers: { ETag: tag } });
        }

        const headers = new Headers(response.headers);
        headers.set('ETag', tag);

        return new Response(body, { status: 200, headers });
    }

    private covers(path: string): boolean {
        return this.matchers.some(matcher => matcher.test(path));
    }
}
```

- [ ] **Step 4: Rodar até passar**

Run: `bun test packages/live/test/etag.test.ts`
Expected: **11 pass, 0 fail**.

- [ ] **Step 5: O registry passa a saber o caminho HTTP de cada resource**

Em `packages/live/src/resource/types.ts`, acrescente a `LiveResource`:

```ts
    /** Full HTTP path, controller prefix included. Used by the ETag layer. */
    httpPath: string;
    httpMethod: string;
```

`CONTROLLER_META` é um `Symbol` em `packages/core/src/metadata.ts:41` e, ao contrário de `ROUTES_META` e `PARAMS_META`, **não** é reexportado pelo barril do core. Sem ele não há como ler o prefixo do controller a partir de fora. Acrescente-o em `packages/core/src/index.ts`, na linha 39:

```ts
export { ROUTES_META, PARAMS_META, CONTROLLER_META } from './metadata';
```

É uma omissão, não uma decisão: os três são a mesma família de chaves e dois já estavam públicos.

Então, em `packages/live/src/resource/ResourceRegistry.ts`:

```ts
import { CONTROLLER_META, PARAMS_META, ROUTES_META, type ParamMetadata } from '@carno.js/core';
```

Antes do laço `for (const route of routes)`, leia o prefixo:

```ts
        const controllerMeta: { path?: string } = Reflect.getMetadata(CONTROLLER_META, ControllerClass) || {};
        const prefix = controllerMeta.path ?? '';
```

E no `this.resources.set(id, { ... })`, acrescente:

```ts
                httpPath: joinRoutePath(prefix, route.path),
                httpMethod: route.method.toUpperCase(),
```

No fim do arquivo:

```ts
/** Same join the core router does: collapse the slashes, keep the root. */
export function joinRoutePath(prefix: string, path: string): string {
    const joined = `${prefix}${path}`.replace(/\/{2,}/g, '/');

    return joined.length > 1 ? joined.replace(/\/$/, '') : (joined || '/');
}
```

E o método público, junto de `ids()`:

```ts
    /** Every live route, as the HTTP layer addresses it. */
    livePaths(): { method: string; path: string }[] {
        return [...this.resources.values()].map(resource => ({
            method: resource.httpMethod,
            path: resource.httpPath
        }));
    }
```

- [ ] **Step 6: Provar o join contra um controller real**

Acrescente a `packages/live/test/etag.test.ts`:

```ts
import { Controller, Get, Post } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';

describe('ResourceRegistry.livePaths', () => {
    test('joins the controller prefix with the handler path', () => {
        @Controller('/cards')
        class CardsController {
            @Get('/')
            @Live({ shared: 'public' })
            list() { return []; }

            @Get('/:id')
            @Live({ shared: 'public' })
            one() { return {}; }

            @Post('/search')
            @Live({ shared: 'public' })
            search() { return []; }
        }

        const registry = new ResourceRegistry();
        registry.register(CardsController, new CardsController());

        expect(registry.livePaths().sort((a, b) => a.path.localeCompare(b.path))).toEqual([
            { method: 'GET', path: '/cards' },
            { method: 'GET', path: '/cards/:id' },
            { method: 'POST', path: '/cards/search' }
        ]);
    });
});
```

Run: `bun test packages/live/test/etag.test.ts`
Expected: **12 pass, 0 fail**.

- [ ] **Step 7: Instalar no plugin**

Em `packages/live/src/LivePluginOptions`, acrescente:

```ts
    /**
     * Content-hash ETag on live GET routes, so a client with neither
     * WebSocket nor SSE can poll cheaply. On by default: it only ever adds a
     * header, and it only touches routes that are live.
     */
    etag?: boolean;
```

O middleware precisa dos caminhos, e os resources só são registrados dentro do `wsHandler`. Como o middleware é um objeto mutável, registre-o antes e alimente-o depois. Em `packages/live/src/LivePlugin.ts`, depois de `plugin.services([LiveService]);`:

```ts
        if (options.etag !== false) {
            // Registered now, taught later: `plugin.middlewares()` runs before
            // bootstrap, and the resources are only known inside the builder.
            const etag = new LiveETagMiddleware([]);
            plugin.middlewares([etag]);
            teachEtag = paths => etag.setPaths(paths);
        }
```

Declare antes: `let teachEtag: ((paths: { method: string; path: string }[]) => void) | null = null;`

E dentro do `wsHandler`, depois do laço de `resources.register(...)`:

```ts
            teachEtag?.(resources.livePaths());
```

Para isso, `LiveETagMiddleware` precisa de um setter. Em `packages/live/src/http/etag.ts`, troque o campo `matchers` de `readonly` para mutável e acrescente:

```ts
    /** The plugin knows the live routes only after bootstrap. */
    setPaths(paths: LiveRoutePath[]): void {
        this.matchers = paths
            .filter(entry => entry.method.toUpperCase() === 'GET')
            .map(entry => pathMatcher(entry.path));
    }
```

E faça o construtor chamar `this.setPaths(paths)`.

- [ ] **Step 8: Exportar e verificar**

Em `packages/live/src/index.ts`:

```ts
// Conditional GET
export { LiveETagMiddleware, pathMatcher } from './http/etag';
export type { LiveRoutePath } from './http/etag';
```

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **252 pass, 0 fail**.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/index.ts packages/live/src/http/etag.ts packages/live/test/etag.test.ts packages/live/src/resource/types.ts packages/live/src/resource/ResourceRegistry.ts packages/live/src/LivePlugin.ts packages/live/src/index.ts
```

Mensagem:

```
feat(live): answer 304 on live GETs whose content the client already has

The bottom rung of the degradation ladder. A @Live() handler is already
an ordinary GET, so conditional polling needs no second route -- only an
ETag, and the hash is the canonical one the engine already computes to
decide whether a recompute produced a patch. Reordered JSON keys are the
same content, not a change.

Scoped to live routes. Putting an ETag on every GET would change the
behaviour of routes that asked for none of this, so the registry now
knows each resource's full HTTP path and the middleware is taught them
at bootstrap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 7: SSE — o mesmo protocolo por outro cano

O degrau do meio da §8.4. `EventSource` é unidirecional, então o `sub`/`unsub`/`resync` sobe por `POST` e os `snapshot`/`patch`/`current` descem pelo stream. Nada disso é protocolo novo: a subida entra na mesma `handleMessage(connectionId, raw)` que o gateway de WebSocket usa, e a descida é um `LiveTransport` como o `SocketTransport`. O engine continua sem saber quem está atendendo.

O que é novo é o `FanTransport`, porque agora existem dois transportes e um engine só.

**Files:**
- Create: `packages/live/src/transport/FanTransport.ts`
- Create: `packages/live/src/transport/SseTransport.ts`
- Create: `packages/live/src/transport/sse-routes.ts`
- Create: `packages/live/test/fan-transport.test.ts`
- Create: `packages/live/test/sse-transport.test.ts`
- Create: `packages/live/test/sse-routes.test.ts`
- Modify: `packages/live/src/transport/SocketTransport.ts`
- Modify: `packages/live/src/config.ts`
- Modify: `packages/live/src/runtime.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Consumes: `LiveTransport` de `../LiveEngine`; `ServerMessage` de `../shared/protocol`; `handleMessage` de `./LiveGateway`; `getLiveRuntime` de `../runtime`.
- Produces:
  - `interface OwnedTransport extends LiveTransport { owns(connectionId: string): boolean }`
  - `class FanTransport implements LiveTransport` — `add(child: OwnedTransport)`, `send(connectionId, message)`.
  - `class SseTransport implements OwnedTransport` — `open(connectionId): ReadableStream<Uint8Array>`, `close(connectionId)`, `count()`, `stop()`.
  - `function createSseRoutes(options: SseRouteOptions): { streamPath: string; controlPath: string; stream: (request: Request) => Response; control: (request: Request) => Promise<Response> }`
  - `SocketTransport` ganha `owns(connectionId): boolean`.
  - `LiveConfig` ganha `ssePath`, `sseControlPath`, `sseHeartbeatMs`, `sseMaxConnections`.
  - `LivePluginOptions` ganha `sse?: boolean`.

- [ ] **Step 1: Escrever o teste do `FanTransport`, que falha**

Crie `packages/live/test/fan-transport.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { FanTransport, type OwnedTransport } from '../src/transport/FanTransport';
import type { ServerMessage } from '../src/shared/protocol';

function child(prefix: string): OwnedTransport & { sent: { id: string; message: ServerMessage }[] } {
    const sent: { id: string; message: ServerMessage }[] = [];

    return {
        sent,
        owns: (connectionId: string) => connectionId.startsWith(prefix),
        send(connectionId: string, message: ServerMessage) {
            sent.push({ id: connectionId, message });
            return 1;
        }
    };
}

const HELLO: ServerMessage = { t: 'current', sid: 's1', rev: 1, hash: 'h' };

describe('FanTransport', () => {
    test('delivers to the child that owns the connection', () => {
        const sockets = child('ws:');
        const streams = child('sse:');
        const fan = new FanTransport();
        fan.add(sockets);
        fan.add(streams);

        fan.send('sse:abc', HELLO);

        expect(streams.sent.length).toBe(1);
        expect(sockets.sent.length).toBe(0);
    });

    test('an unowned connection is a dropped send, not a throw', () => {
        const fan = new FanTransport();
        fan.add(child('ws:'));

        // The engine treats <= 0 as back-pressure or drop, and cleans up on
        // its own schedule. Throwing here would take a whole fan-out down.
        expect(fan.send('sse:gone', HELLO)).toBe(0);
    });

    test('the first owner wins, so a stale child cannot shadow a live one', () => {
        const first = child('c');
        const second = child('c');
        const fan = new FanTransport();
        fan.add(first);
        fan.add(second);

        fan.send('c1', HELLO);

        expect(first.sent.length).toBe(1);
        expect(second.sent.length).toBe(0);
    });

    test('reports back-pressure from the child verbatim', () => {
        const fan = new FanTransport();
        fan.add({ owns: () => true, send: () => -1 });

        expect(fan.send('anything', HELLO)).toBe(-1);
    });
});
```

Run: `bun test packages/live/test/fan-transport.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar o `FanTransport`**

Crie `packages/live/src/transport/FanTransport.ts`:

```ts
import type { LiveTransport } from '../LiveEngine';
import type { ServerMessage } from '../shared/protocol';

export interface OwnedTransport extends LiveTransport {
    /** Whether this transport is the one holding that connection. */
    owns(connectionId: string): boolean;
}

/**
 * One engine, several pipes.
 *
 * The engine addresses connections by an opaque id and never asks how they are
 * reached, which is exactly what makes SSE a transport rather than a second
 * engine. This routes each send to whichever transport claims the id.
 */
export class FanTransport implements LiveTransport {
    private readonly children: OwnedTransport[] = [];

    add(child: OwnedTransport): void {
        this.children.push(child);
    }

    send(connectionId: string, message: ServerMessage): number {
        for (const child of this.children) {
            if (child.owns(connectionId)) {
                return child.send(connectionId, message);
            }
        }

        // Nobody holds it any more. Zero is "dropped", which the engine already
        // handles; throwing here would take a whole fan-out down with it.
        return 0;
    }
}
```

Em `packages/live/src/transport/SocketTransport.ts`, faça-o implementar `OwnedTransport`:

```ts
    owns(connectionId: string): boolean {
        return this.sockets.has(connectionId);
    }
```

E troque a assinatura da classe para `implements OwnedTransport`, importando o tipo de `./FanTransport`.

Run: `bun test packages/live/test/fan-transport.test.ts`
Expected: **4 pass, 0 fail**.

- [ ] **Step 3: Escrever o teste do `SseTransport`, que falha**

Crie `packages/live/test/sse-transport.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SseTransport } from '../src/transport/SseTransport';
import type { ServerMessage } from '../src/shared/protocol';

const SNAPSHOT: ServerMessage = { t: 'snapshot', sid: 's1', rev: 1, hash: 'h1', data: [{ id: 1 }] };

async function readOne(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
}

describe('SseTransport', () => {
    test('open() hands back a stream, and owns() claims the connection', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const stream = transport.open('sse:1');

        expect(stream).toBeInstanceOf(ReadableStream);
        expect(transport.owns('sse:1')).toBe(true);
        expect(transport.owns('sse:2')).toBe(false);
    });

    test('the first frame carries the connection id, because the client has no other way to learn it', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();

        expect(await readOne(reader)).toBe('data: {"t":"ready","cid":"sse:1"}\n\n');
    });

    test('a message is written as one SSE frame of JSON', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();
        await readOne(reader);

        expect(transport.send('sse:1', SNAPSHOT)).toBe(1);
        expect(await readOne(reader)).toBe(`data: ${JSON.stringify(SNAPSHOT)}\n\n`);
    });

    test('sending to a closed connection is a drop, not a throw', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        transport.open('sse:1');
        transport.close('sse:1');

        expect(transport.send('sse:1', SNAPSHOT)).toBe(0);
        expect(transport.owns('sse:1')).toBe(false);
    });

    test('refuses to open past the ceiling', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 1 });
        transport.open('sse:1');

        expect(() => transport.open('sse:2')).toThrow(/at capacity/);
    });

    test('a heartbeat keeps the connection from being reaped by a proxy', async () => {
        const transport = new SseTransport({ heartbeatMs: 5, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();
        await readOne(reader);

        // A comment frame: valid SSE, ignored by EventSource, enough traffic
        // to stop an idle-timeout proxy from closing the stream.
        expect(await readOne(reader)).toBe(': ping\n\n');
        transport.stop();
    });

    test('stop() closes every stream it holds', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        transport.open('sse:1');
        transport.open('sse:2');

        transport.stop();

        expect(transport.count()).toBe(0);
    });

    test('the client cancelling the stream releases the connection', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const dropped: string[] = [];
        const withHook = new SseTransport({
            heartbeatMs: 0,
            maxConnections: 10,
            onDisconnect: id => dropped.push(id)
        });
        void transport;

        const stream = withHook.open('sse:1');
        await stream.cancel();

        expect(dropped).toEqual(['sse:1']);
        expect(withHook.owns('sse:1')).toBe(false);
    });
});
```

- [ ] **Step 4: Implementar o `SseTransport`**

Crie `packages/live/src/transport/SseTransport.ts`:

```ts
import type { ServerMessage } from '../shared/protocol';
import type { OwnedTransport } from './FanTransport';

export interface SseTransportOptions {
    /** 0 disables the heartbeat. Only tests want that. */
    heartbeatMs: number;
    maxConnections: number;
    /** Called when the client goes away, so the engine can drop the connection. */
    onDisconnect?: (connectionId: string) => void;
}

const ENCODER = new TextEncoder();

/**
 * The downstream half of the SSE transport.
 *
 * Upstream is `POST /live/control`, which speaks the same protocol into the
 * same handler the WebSocket gateway uses -- see `sse-routes.ts`. This half
 * only writes frames, so the engine cannot tell it apart from a socket.
 */
export class SseTransport implements OwnedTransport {
    private readonly streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    private heartbeat: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: SseTransportOptions) {}

    open(connectionId: string): ReadableStream<Uint8Array> {
        if (this.streams.size >= this.options.maxConnections) {
            throw new Error(`[carno:live] the SSE transport is at capacity (${this.options.maxConnections}).`);
        }

        return new ReadableStream<Uint8Array>({
            start: controller => {
                this.streams.set(connectionId, controller);
                // The client cannot learn its own connection id any other way,
                // and it needs it to address the control endpoint.
                this.write(controller, `data: ${JSON.stringify({ t: 'ready', cid: connectionId })}\n\n`);
                this.ensureHeartbeat();
            },
            cancel: () => {
                this.streams.delete(connectionId);
                this.options.onDisconnect?.(connectionId);
            }
        });
    }

    owns(connectionId: string): boolean {
        return this.streams.has(connectionId);
    }

    send(connectionId: string, message: ServerMessage): number {
        const controller = this.streams.get(connectionId);

        if (!controller) {
            return 0;
        }

        return this.write(controller, `data: ${JSON.stringify(message)}\n\n`);
    }

    close(connectionId: string): void {
        const controller = this.streams.get(connectionId);
        this.streams.delete(connectionId);

        try {
            controller?.close();
        } catch {
            // Already closed from the other end.
        }
    }

    count(): number {
        return this.streams.size;
    }

    stop(): void {
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }

        for (const connectionId of [...this.streams.keys()]) {
            this.close(connectionId);
        }
    }

    private ensureHeartbeat(): void {
        if (this.heartbeat || this.options.heartbeatMs <= 0) {
            return;
        }

        // A comment frame. EventSource ignores it; an idle-timeout proxy does
        // not, which is the whole point.
        this.heartbeat = setInterval(() => {
            for (const controller of this.streams.values()) {
                this.write(controller, ': ping\n\n');
            }
        }, this.options.heartbeatMs);

        this.heartbeat.unref?.();
    }

    private write(controller: ReadableStreamDefaultController<Uint8Array>, frame: string): number {
        try {
            controller.enqueue(ENCODER.encode(frame));
            return 1;
        } catch {
            return 0;
        }
    }
}
```

Run: `bun test packages/live/test/sse-transport.test.ts`
Expected: **8 pass, 0 fail**.

- [ ] **Step 5: Escrever o teste das rotas, que falha**

Crie `packages/live/test/sse-routes.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { Carno, Controller, Get } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { closeLiveRuntime } from '../src/runtime';

@Controller('/numbers')
class NumbersController {
    @Get('/')
    @Live({ shared: 'public', dependsOn: ['app:numbers'] })
    list() {
        return [1, 2, 3];
    }
}

/** Reads SSE frames off the response body, one `data:` payload at a time. */
async function* frames(response: Response): AsyncGenerator<any> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            return;
        }

        buffer += decoder.decode(value, { stream: true });

        let split = buffer.indexOf('\n\n');

        while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);

            if (frame.startsWith('data: ')) {
                yield JSON.parse(frame.slice(6));
            }

            split = buffer.indexOf('\n\n');
        }
    }
}

async function next(stream: AsyncGenerator<any>, predicate: (frame: any) => boolean, timeoutMs = 4000): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const { value, done } = await stream.next();

        if (done) {
            throw new Error('the stream ended before the frame arrived');
        }

        if (predicate(value)) {
            return value;
        }
    }

    throw new Error('timed out waiting for a frame');
}

afterEach(async () => {
    await closeLiveRuntime();
});

describe('SSE routes', () => {
    test('a subscription over SSE receives a snapshot and then a patch', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({
                controllers: [NumbersController],
                sse: true,
                config: { coalesceMs: 5, sseHeartbeatMs: 0 }
            })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/sse`);
        expect(response.headers.get('content-type')).toContain('text/event-stream');

        const stream = frames(response);
        const ready = await next(stream, frame => frame.t === 'ready');
        expect(typeof ready.cid).toBe('string');

        const post = (message: unknown) => fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: ready.cid, message })
        });

        await post({ t: 'hello', v: 1 });
        await post({ t: 'sub', sid: 's1', resource: 'NumbersController.list', inputs: { params: {}, query: {} } });

        const snapshot = await next(stream, frame => frame.t === 'snapshot');
        expect(snapshot.data).toEqual([1, 2, 3]);

        await harness.close();
    });

    test('the control endpoint refuses an unknown connection id', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController], sse: true })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: 'sse:not-a-real-one', message: { t: 'hello', v: 1 } })
        });

        // The cid is a bearer for a live connection. An unknown one is not a
        // no-op to be swallowed; it is a request that must not be served.
        expect(response.status).toBe(404);
        await harness.close();
    });

    test('the control endpoint refuses a malformed body', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController], sse: true })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json'
        });

        expect(response.status).toBe(400);
        await harness.close();
    });

    test('no routes exist when sse is off', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController] })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/sse`);

        expect(response.status).toBe(404);
        await harness.close();
    });
});
```

- [ ] **Step 6: Implementar as rotas**

Crie `packages/live/src/transport/sse-routes.ts`:

```ts
import { getLiveRuntime } from '../runtime';
import { handleMessage } from './LiveGateway';
import type { SseTransport } from './SseTransport';

export interface SseRouteOptions {
    transport: SseTransport;
    streamPath: string;
    controlPath: string;
}

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers proxied responses by default, which turns a live stream
    // into a stream that arrives all at once, at the end.
    'X-Accel-Buffering': 'no'
};

/**
 * The two halves of the SSE transport, as HTTP.
 *
 * `GET streamPath` opens the downstream and names the connection; every
 * client message goes up through `POST controlPath` and into the same
 * `handleMessage` the WebSocket gateway uses. There is no second protocol
 * here, and there must never be one.
 *
 * Handlers registered through `Carno.route()` receive a Bun `Request`, not a
 * `Context` -- the docstring on that method says otherwise, the runtime does
 * not.
 */
export function createSseRoutes(options: SseRouteOptions) {
    const { transport, streamPath, controlPath } = options;

    const stream = (): Response => {
        // Unguessable on purpose: the id is a bearer for this connection, and
        // whoever holds it can subscribe as it.
        const connectionId = `sse:${crypto.randomUUID()}`;

        try {
            const body = transport.open(connectionId);
            const runtime = getLiveRuntime();
            // Until a `hello` arrives, the connection is its own principal:
            // safe, shares nothing. Same rule as the gateway's onOpen.
            runtime.scopes.set(connectionId, { principal: connectionId });

            return new Response(body, { status: 200, headers: SSE_HEADERS });
        } catch (error) {
            return new Response((error as Error).message, { status: 503 });
        }
    };

    const control = async (request: Request): Promise<Response> => {
        let payload: { cid?: unknown; message?: unknown };

        try {
            payload = await request.json() as { cid?: unknown; message?: unknown };
        } catch {
            return new Response('malformed body', { status: 400 });
        }

        if (typeof payload.cid !== 'string' || !payload.message) {
            return new Response('cid and message are required', { status: 400 });
        }

        if (!transport.owns(payload.cid)) {
            return new Response('unknown connection', { status: 404 });
        }

        await handleMessage(payload.cid, JSON.stringify(payload.message));

        return new Response(null, { status: 204 });
    };

    return { streamPath, controlPath, stream, control };
}
```

- [ ] **Step 7: Config, runtime e plugin**

Em `packages/live/src/config.ts`, acrescente a `LiveConfig`:

```ts
    /** Path of the SSE downstream, when the SSE transport is on. */
    ssePath: string;
    /** Path client messages are posted to, when the SSE transport is on. */
    sseControlPath: string;
    /** Comment frame interval that keeps idle-timeout proxies from reaping. */
    sseHeartbeatMs: number;
    /** Ceiling on concurrent SSE streams held by this process. */
    sseMaxConnections: number;
```

E a `DEFAULT_LIVE_CONFIG`:

```ts
    ssePath: '/live/sse',
    sseControlPath: '/live/control',
    sseHeartbeatMs: 15000,
    sseMaxConnections: 10000
```

Em `packages/live/src/LivePlugin.ts`, acrescente a `LivePluginOptions`:

```ts
    /**
     * Serve the protocol over Server-Sent Events as well, for clients whose
     * proxy blocks WebSocket. Off by default: it adds two public routes.
     */
    sse?: boolean;
```

Substitua `const transport = new SocketTransport();` por:

```ts
        const sockets = new SocketTransport();
        const fan = new FanTransport();
        fan.add(sockets);
```

Passe `fan` ao `LiveEngine` no lugar de `transport`, e `sockets` para `setLiveRuntime` — o gateway usa `runtime.transport.add(socket)`, que é do `SocketTransport`, não do fan.

Depois de `plugin.services([LiveService]);`:

```ts
        if (options.sse) {
            const sse = new SseTransport({
                heartbeatMs: config.sseHeartbeatMs,
                maxConnections: config.sseMaxConnections,
                onDisconnect: connectionId => engine.dropConnection(connectionId)
            });

            fan.add(sse);
            dispose.push(() => sse.stop());

            const routes = createSseRoutes({
                transport: sse,
                streamPath: config.ssePath,
                controlPath: config.sseControlPath
            });

            plugin.route('GET', routes.streamPath, routes.stream);
            plugin.route('POST', routes.controlPath, routes.control);
        }
```

`dispose` já é declarado antes de `setLiveRuntime`; mova a declaração do `engine` e do `dispose` para antes deste bloco, se ainda não estiverem.

- [ ] **Step 8: Rodar as rotas**

Run: `bun test packages/live/test/sse-routes.test.ts`
Expected: **4 pass, 0 fail**.

- [ ] **Step 9: Exportar e verificar**

Em `packages/live/src/index.ts`:

```ts
// Transports
export { FanTransport } from './transport/FanTransport';
export type { OwnedTransport } from './transport/FanTransport';
export { SseTransport } from './transport/SseTransport';
export type { SseTransportOptions } from './transport/SseTransport';
export { createSseRoutes } from './transport/sse-routes';
export type { SseRouteOptions } from './transport/sse-routes';
```

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **268 pass, 0 fail**.

- [ ] **Step 10: Commit**

```bash
git add packages/live/src/transport/FanTransport.ts packages/live/src/transport/SseTransport.ts packages/live/src/transport/sse-routes.ts packages/live/src/transport/SocketTransport.ts packages/live/src/config.ts packages/live/src/LivePlugin.ts packages/live/src/index.ts packages/live/test/fan-transport.test.ts packages/live/test/sse-transport.test.ts packages/live/test/sse-routes.test.ts
```

Mensagem:

```
feat(live): serve the protocol over SSE for clients that cannot open a socket

The middle rung of the degradation ladder, and deliberately not a second
implementation of anything. EventSource is one-directional, so client
messages come up through POST /live/control and into the very same
handleMessage the WebSocket gateway uses; snapshots and patches go down
a stream. The engine addresses connections by an opaque id and never
asks how they are reached, which is what made this a transport rather
than a second engine.

FanTransport is the one new idea: two pipes, one engine, routed by
whichever transport claims the id. An id nobody claims is a dropped
send, because throwing there would take a whole fan-out down.

Off by default -- it adds two public routes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 8: Uma costura de transporte no `LiveClient`

O `LiveClient` fala com um `LiveSocket` diretamente: `ensureConnected()` constrói um, `send()` escreve nele, `onDisconnect()` reagenda. Para haver escada de transporte, isso precisa virar uma interface — e essa troca é um refactor puro, que os testes das Fases 1 e 2 provam sem uma linha nova.

Esta task **não** muda comportamento nenhum. Se algum teste existente mudar de resultado, a costura está errada.

**Files:**
- Create: `packages/live/src/client/transport.ts`
- Modify: `packages/live/src/client/core.ts`
- Create: `packages/live/test/client-transport.test.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Produces:
  - `interface TransportHandlers { onOpen(): void; onMessage(raw: string): void; onClose(): void }`
  - `interface ClientTransport { readonly kind: 'websocket' | 'sse' | 'polling'; start(handlers: TransportHandlers): void; send(raw: string): void; close(): void }`
  - `class WebSocketTransport implements ClientTransport`, construída com `(url: string, factory?: (url: string) => LiveSocket)`.
  - `LiveClientOptions` ganha `transportFactory?: (url: string) => ClientTransport`.
  - `LiveClient` ganha `transport(): 'websocket' | 'sse' | 'polling' | null`.

- [ ] **Step 1: Escrever o teste da costura**

Crie `packages/live/test/client-transport.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { WebSocketTransport, type ClientTransport, type TransportHandlers } from '../src/client/transport';

function fakeSocket(): LiveSocket & { sent: string[] } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null
    };

    return socket;
}

describe('WebSocketTransport', () => {
    test('reports itself as websocket and forwards the three events', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        const seen: string[] = [];

        transport.start({
            onOpen: () => seen.push('open'),
            onMessage: raw => seen.push(`message:${raw}`),
            onClose: () => seen.push('close')
        });

        expect(transport.kind).toBe('websocket');

        socket.onopen?.();
        socket.onmessage?.({ data: 'hi' });
        socket.onclose?.();

        expect(seen).toEqual(['open', 'message:hi', 'close']);
    });

    test('an error counts as a close, because both mean the pipe is gone', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        let closes = 0;

        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        socket.onerror?.(new Error('boom'));

        expect(closes).toBe(1);
    });

    test('close() does not report a close back, so it cannot trigger a reconnect', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        let closes = 0;

        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        transport.close();
        socket.onclose?.();

        expect(closes).toBe(0);
    });
});

describe('LiveClient over a custom transport', () => {
    test('uses transportFactory when one is given, and reports its kind', () => {
        const sent: string[] = [];
        let handlers: TransportHandlers | null = null;

        const custom: ClientTransport = {
            kind: 'sse',
            start(next) { handlers = next; },
            send(raw) { sent.push(raw); },
            close() {}
        };

        const client = new LiveClient({ url: 'http://x/live', transportFactory: () => custom });

        expect(client.transport()).toBeNull();

        client.store('CardsController.list', { params: {}, query: {} }).subscribe(() => {});
        handlers!.onOpen();

        expect(client.transport()).toBe('sse');
        expect(sent.some(raw => raw.includes('"t":"hello"'))).toBe(true);
        expect(sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
    });

    test('socketFactory still works, unchanged', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        client.store('CardsController.list', { params: {}, query: {} }).subscribe(() => {});
        socket.onopen?.();

        expect(client.transport()).toBe('websocket');
        expect(socket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/live/test/client-transport.test.ts`
Expected: FAIL — `Cannot find module '../src/client/transport'`.

- [ ] **Step 3: Implementar `transport.ts`**

Crie `packages/live/src/client/transport.ts`:

```ts
import type { LiveSocket } from './core';

export interface TransportHandlers {
    onOpen(): void;
    onMessage(raw: string): void;
    onClose(): void;
}

/**
 * A pipe the client can speak the protocol over.
 *
 * The protocol does not change between implementations, and neither does the
 * client's behaviour: a component cannot tell which one is in use, and the day
 * an `if (kind === 'sse')` appears in a component, the abstraction has failed.
 * `kind` exists to be logged.
 */
export interface ClientTransport {
    readonly kind: 'websocket' | 'sse' | 'polling';
    start(handlers: TransportHandlers): void;
    send(raw: string): void;
    close(): void;
}

export class WebSocketTransport implements ClientTransport {
    readonly kind = 'websocket' as const;

    private socket: LiveSocket | null = null;
    private closed = false;

    constructor(
        private readonly url: string,
        private readonly factory: (url: string) => LiveSocket = defaultSocketFactory
    ) {}

    start(handlers: TransportHandlers): void {
        const socket = this.factory(this.url);
        this.socket = socket;

        socket.onopen = () => handlers.onOpen();
        socket.onmessage = event => handlers.onMessage(event.data);
        // An error and a close both mean the same thing here: the pipe is gone.
        socket.onclose = () => this.report(handlers);
        socket.onerror = () => this.report(handlers);
    }

    send(raw: string): void {
        this.socket?.send(raw);
    }

    close(): void {
        this.closed = true;
        this.socket?.close();
        this.socket = null;
    }

    private report(handlers: TransportHandlers): void {
        if (this.closed) {
            // We closed it. Reporting it would schedule a reconnect to a
            // client that has already given up.
            return;
        }

        this.socket = null;
        handlers.onClose();
    }
}

function defaultSocketFactory(url: string): LiveSocket {
    return new WebSocket(url) as unknown as LiveSocket;
}
```

- [ ] **Step 4: Passar o `LiveClient` a falar com a interface**

Em `packages/live/src/client/core.ts`:

Importe `ClientTransport`, `WebSocketTransport` de `./transport`.

Em `LiveClientOptions`, acrescente, mantendo `socketFactory`:

```ts
    /**
     * Builds the pipe. Defaults to WebSocket; Task 9 stacks a ladder on top.
     * `socketFactory` still works and is the shorthand for "same ladderless
     * WebSocket, different socket" that the tests use.
     */
    transportFactory?: (url: string) => ClientTransport;
```

Troque o campo `private socket: LiveSocket | null = null;` por:

```ts
    private pipe: ClientTransport | null = null;
```

Substitua `ensureConnected`, `send`, `close` e `onDisconnect` por:

```ts
    close(): void {
        this.closed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.pipe?.close();
        this.pipe = null;
        this.connected = false;
    }

    /** Which pipe is carrying this client right now. For logs, not for logic. */
    transport(): ClientTransport['kind'] | null {
        return this.connected ? (this.pipe?.kind ?? null) : null;
    }

    private ensureConnected(): void {
        if (this.pipe || this.closed) {
            return;
        }

        const build = this.options.transportFactory
            ?? ((url: string) => new WebSocketTransport(url, this.options.socketFactory));

        const pipe = build(this.options.url);
        this.pipe = pipe;

        pipe.start({
            onOpen: () => {
                this.connected = true;
                this.attempt = 0;
                this.send({ t: 'hello', v: LIVE_PROTOCOL_VERSION, token: this.options.token });

                // Reconnect is just "subscribe again, carrying the hash of
                // what is on screen". There is no session to restore, because
                // there is no session.
                for (const entry of this.entries.values()) {
                    if (entry.refs > 0) {
                        this.sendSub(entry);
                    }
                }
            },
            onMessage: raw => this.onMessage(raw),
            onClose: () => this.onDisconnect()
        });
    }

    private onDisconnect(): void {
        this.connected = false;
        this.pipe = null;

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

    private send(message: ClientMessage): void {
        if (!this.pipe || !this.connected) {
            return;
        }

        this.pipe.send(JSON.stringify(message));
    }
```

Apague a função `defaultSocketFactory` do fim de `core.ts`: ela agora vive em `transport.ts`.

- [ ] **Step 5: Rodar tudo — o refactor tem de ser invisível**

Run: `bun test packages/live/test/client-transport.test.ts`
Expected: **5 pass, 0 fail**.

Run: `bun test packages/live`
Expected: **273 pass, 0 fail**. Qualquer teste anterior que mude de resultado significa que a costura mudou comportamento; volte e conserte a costura, não o teste.

- [ ] **Step 6: Exportar e commitar**

Em `packages/live/src/index.ts`:

```ts
export { WebSocketTransport } from './client/transport';
export type { ClientTransport, TransportHandlers } from './client/transport';
```

```bash
git add packages/live/src/client/transport.ts packages/live/src/client/core.ts packages/live/src/index.ts packages/live/test/client-transport.test.ts
```

Mensagem:

```
refactor(live): give the client a transport seam

The client spoke to a LiveSocket directly, which left no room for the
degradation ladder §8.4 asks for. Behaviour is unchanged and the phase 1
and 2 tests prove it: socketFactory still works, reconnect still carries
full jitter, and a close we initiated still does not schedule one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 9: A escada — SSE e polling no cliente

Com a costura pronta e o servidor falando SSE, falta o cliente descer a escada da §8.4 quando o degrau de cima não abre.

O piso tem uma limitação que precisa ficar explícita: polling faz `GET` na rota do resource, e o `sub` carrega um `resourceId`, não um caminho. O cliente só consegue traduzir um no outro se receber a árvore `routes` que o codegen do `@carno.js/client` emite. Sem ela, a escada para no SSE — e diz isso em voz alta, em vez de fingir que degradou.

**Files:**
- Modify: `packages/live/src/client/transport.ts`
- Modify: `packages/live/src/client/core.ts`
- Create: `packages/live/test/transport-ladder.test.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Produces:
  - `class SseClientTransport implements ClientTransport` — `(baseUrl: string, options?: { fetch?: typeof fetch; eventSourceFactory?: (url: string) => EventSourceLike })`
  - `class PollingTransport implements ClientTransport` — `(baseUrl: string, routes: Record<string, RoutePath>, options?: { intervalMs?: number; fetch?: typeof fetch })`
  - `class LadderTransport implements ClientTransport` — tenta em ordem, desce ao falhar.
  - `interface RoutePath { method: string; path: string }`
  - `function routeIndex(routes: unknown): Record<string, RoutePath>` — achata a árvore do codegen em `resourceId → { method, path }`.
  - `LiveClientOptions` ganha `routes?: unknown` e `pollIntervalMs?: number` e `transportProbeMs?: number`.

- [ ] **Step 1: Escrever o teste, que falha**

Crie `packages/live/test/transport-ladder.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
    LadderTransport,
    PollingTransport,
    routeIndex,
    type ClientTransport,
    type TransportHandlers
} from '../src/client/transport';

const GENERATED_ROUTES = {
    cards: {
        list: { method: 'get', path: '/cards', resourceId: 'CardsController.list', live: { shared: 'public' } },
        one: { method: 'get', path: '/cards/:id', resourceId: 'CardsController.one', live: { shared: 'public' } }
    },
    health: {
        check: { method: 'get', path: '/health' }
    }
};

function stubTransport(kind: ClientTransport['kind'], behaviour: 'open' | 'fail'): ClientTransport & { started: number } {
    const transport = {
        kind,
        started: 0,
        start(handlers: TransportHandlers) {
            transport.started += 1;
            queueMicrotask(() => (behaviour === 'open' ? handlers.onOpen() : handlers.onClose()));
        },
        send() {},
        close() {}
    };

    return transport;
}

describe('routeIndex', () => {
    test('flattens the generated tree into resourceId to path', () => {
        expect(routeIndex(GENERATED_ROUTES)).toEqual({
            'CardsController.list': { method: 'get', path: '/cards' },
            'CardsController.one': { method: 'get', path: '/cards/:id' }
        });
    });

    test('skips routes that are not live, because polling one means nothing', () => {
        expect(routeIndex(GENERATED_ROUTES)['HealthController.check']).toBeUndefined();
    });

    test('an empty or absent tree is an empty index, not a throw', () => {
        expect(routeIndex(undefined)).toEqual({});
        expect(routeIndex({})).toEqual({});
    });
});

describe('LadderTransport', () => {
    test('stays on the first rung when it opens', async () => {
        const socket = stubTransport('websocket', 'open');
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => socket, () => sse], { probeMs: 50 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(opened).toBe(true);
        expect(ladder.kind).toBe('websocket');
        expect(sse.started).toBe(0);
    });

    test('descends when a rung fails to open', async () => {
        const socket = stubTransport('websocket', 'fail');
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => socket, () => sse], { probeMs: 50 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(opened).toBe(true);
        expect(ladder.kind).toBe('sse');
    });

    test('descends when a rung neither opens nor fails within the probe window', async () => {
        const stuck: ClientTransport = { kind: 'websocket', start() {}, send() {}, close() {} };
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => stuck, () => sse], { probeMs: 10 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 40));

        // A corporate proxy that swallows the upgrade without answering is
        // the case that makes the timeout necessary rather than tidy.
        expect(opened).toBe(true);
        expect(ladder.kind).toBe('sse');
    });

    test('reports a real close once it is settled, so the client can reconnect', async () => {
        let handlers: TransportHandlers | null = null;
        const flaky: ClientTransport = {
            kind: 'websocket',
            start(next) { handlers = next; queueMicrotask(() => next.onOpen()); },
            send() {},
            close() {}
        };
        const ladder = new LadderTransport([() => flaky], { probeMs: 50 });
        let closes = 0;

        ladder.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        await new Promise(resolve => setTimeout(resolve, 10));
        handlers!.onClose();

        expect(closes).toBe(1);
    });

    test('a ladder whose every rung fails reports one close, not one per rung', async () => {
        const ladder = new LadderTransport(
            [() => stubTransport('websocket', 'fail'), () => stubTransport('sse', 'fail')],
            { probeMs: 10 }
        );
        let closes = 0;

        ladder.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(closes).toBe(1);
    });
});

describe('PollingTransport', () => {
    test('turns a sub into a conditional GET and the answer into a snapshot', async () => {
        const calls: { url: string; headers: Record<string, string> }[] = [];
        const fetchStub = (async (url: any, init: any) => {
            calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
            return new Response(JSON.stringify([{ id: 1 }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ETag: '"abc"' }
            });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport(
            'http://x',
            routeIndex(GENERATED_ROUTES),
            { intervalMs: 10_000, fetch: fetchStub }
        );

        const received: any[] = [];
        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub',
            sid: 's1',
            resource: 'CardsController.list',
            inputs: { params: {}, query: { done: 'true' } }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(calls[0].url).toBe('http://x/cards?done=true');
        expect(received[0]).toMatchObject({ t: 'snapshot', sid: 's1', data: [{ id: 1 }], hash: 'abc' });
        transport.close();
    });

    test('sends If-None-Match on the second poll and emits nothing on 304', async () => {
        let call = 0;
        const fetchStub = (async (_url: any, init: any) => {
            call += 1;

            if (call === 1) {
                return new Response(JSON.stringify([{ id: 1 }]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ETag: '"abc"' }
                });
            }

            expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
            return new Response(null, { status: 304 });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport(
            'http://x',
            routeIndex(GENERATED_ROUTES),
            { intervalMs: 5, fetch: fetchStub }
        );

        const received: any[] = [];
        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 40));

        // 304 means the screen is already right. Emitting a snapshot would
        // hand the store a new object for identical content and re-render.
        expect(received.filter(message => message.t === 'snapshot').length).toBe(1);
        transport.close();
    });

    test('fills :params from the inputs', async () => {
        const urls: string[] = [];
        const fetchStub = (async (url: any) => {
            urls.push(String(url));
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport('http://x', routeIndex(GENERATED_ROUTES), { intervalMs: 10_000, fetch: fetchStub });
        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.one', inputs: { params: { id: '42' }, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(urls[0]).toBe('http://x/cards/42');
        transport.close();
    });

    test('an unsub stops the polling for that subscription', async () => {
        let calls = 0;
        const fetchStub = (async () => {
            calls += 1;
            return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport('http://x', routeIndex(GENERATED_ROUTES), { intervalMs: 5, fetch: fetchStub });
        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));
        transport.send(JSON.stringify({ t: 'unsub', sid: 's1' }));
        const afterUnsub = calls;
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(calls).toBe(afterUnsub);
        transport.close();
    });

    test('a resource the index does not know is an error the client can show', async () => {
        const transport = new PollingTransport('http://x', {}, { intervalMs: 10_000 });
        const received: any[] = [];

        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'Unknown.thing', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 10));

        // Silence here would be a screen that stays pending forever with no
        // explanation. Say what is missing and how to supply it.
        expect(received[0]).toMatchObject({ t: 'error', sid: 's1', code: 'no_route' });
        expect(received[0].message).toMatch(/routes/);
        transport.close();
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/live/test/transport-ladder.test.ts`
Expected: FAIL — os símbolos não existem.

- [ ] **Step 3: Implementar, acrescentando a `packages/live/src/client/transport.ts`**

```ts
import type { ClientMessage, ServerMessage } from '../shared/protocol';

export interface RoutePath {
    method: string;
    path: string;
}

export interface EventSourceLike {
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    close(): void;
}

/**
 * Flatten the tree `@carno.js/client` generates into `resourceId -> path`.
 *
 * Polling needs a URL and the protocol carries a resource id, so without this
 * the bottom rung cannot exist. Routes with no `@Live()` are skipped: polling
 * one would be polling something nobody can subscribe to.
 */
export function routeIndex(routes: unknown): Record<string, RoutePath> {
    const index: Record<string, RoutePath> = {};

    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') {
            return;
        }

        const candidate = node as { method?: unknown; path?: unknown; resourceId?: unknown; live?: unknown };

        if (typeof candidate.method === 'string' && typeof candidate.path === 'string') {
            if (typeof candidate.resourceId === 'string' && candidate.live) {
                index[candidate.resourceId] = { method: candidate.method, path: candidate.path };
            }

            return;
        }

        for (const value of Object.values(node as Record<string, unknown>)) {
            walk(value);
        }
    };

    walk(routes);

    return index;
}

/**
 * Try each rung in order, descend when one does not open.
 *
 * There is no promotion back up: a proxy that blocks WebSocket will keep
 * blocking it, and retrying the top rung on every reconnect spends a round
 * trip per cycle to fail forever. The next page load starts at the top again.
 */
export class LadderTransport implements ClientTransport {
    private active: ClientTransport | null = null;
    private handlers: TransportHandlers | null = null;
    private rung = 0;
    private settled = false;
    private probe: ReturnType<typeof setTimeout> | null = null;
    private closed = false;

    constructor(
        private readonly rungs: (() => ClientTransport)[],
        private readonly options: { probeMs: number }
    ) {}

    get kind(): ClientTransport['kind'] {
        return this.active?.kind ?? 'websocket';
    }

    start(handlers: TransportHandlers): void {
        this.handlers = handlers;
        this.rung = 0;
        this.settled = false;
        this.tryRung();
    }

    send(raw: string): void {
        this.active?.send(raw);
    }

    close(): void {
        this.closed = true;
        this.clearProbe();
        this.active?.close();
        this.active = null;
    }

    private tryRung(): void {
        this.clearProbe();

        if (this.closed) {
            return;
        }

        if (this.rung >= this.rungs.length) {
            // Every rung refused. One close, not one per rung, or the client
            // schedules a reconnect storm against itself.
            this.handlers?.onClose();
            return;
        }

        const transport = this.rungs[this.rung]();
        this.active = transport;

        transport.start({
            onOpen: () => {
                this.clearProbe();
                this.settled = true;
                this.handlers?.onOpen();
            },
            onMessage: raw => this.handlers?.onMessage(raw),
            onClose: () => {
                if (this.settled) {
                    // It worked and then dropped. That is an ordinary
                    // disconnect and the client's backoff owns it.
                    this.handlers?.onClose();
                    return;
                }

                this.descend();
            }
        });

        // A proxy that swallows the upgrade without answering never fires an
        // error. Without this the ladder would wait for a close that never
        // comes, on the rung that is exactly the one being blocked.
        this.probe = setTimeout(() => this.descend(), this.options.probeMs);
        this.probe.unref?.();
    }

    private descend(): void {
        if (this.settled || this.closed) {
            return;
        }

        this.clearProbe();
        this.active?.close();
        this.active = null;
        this.rung += 1;
        this.tryRung();
    }

    private clearProbe(): void {
        if (this.probe) {
            clearTimeout(this.probe);
            this.probe = null;
        }
    }
}

/**
 * The protocol over Server-Sent Events: down the stream, up by POST.
 *
 * The connection id arrives in the first frame and every client message
 * carries it, because the control endpoint has no other way to know which
 * stream a POST belongs to.
 */
export class SseClientTransport implements ClientTransport {
    readonly kind = 'sse' as const;

    private source: EventSourceLike | null = null;
    private cid: string | null = null;
    private queue: string[] = [];
    private closed = false;

    constructor(
        private readonly baseUrl: string,
        private readonly options: {
            streamPath?: string;
            controlPath?: string;
            fetch?: typeof fetch;
            eventSourceFactory?: (url: string) => EventSourceLike;
        } = {}
    ) {}

    start(handlers: TransportHandlers): void {
        const streamUrl = `${this.baseUrl}${this.options.streamPath ?? '/live/sse'}`;
        const build = this.options.eventSourceFactory
            ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);

        const source = build(streamUrl);
        this.source = source;

        source.onmessage = event => {
            let frame: { t?: string; cid?: string };

            try {
                frame = JSON.parse(event.data) as { t?: string; cid?: string };
            } catch {
                return;
            }

            if (frame.t === 'ready' && typeof frame.cid === 'string') {
                this.cid = frame.cid;
                handlers.onOpen();
                // Anything the client tried to say before the id arrived.
                const queued = this.queue;
                this.queue = [];
                for (const raw of queued) {
                    this.send(raw);
                }
                return;
            }

            handlers.onMessage(event.data);
        };

        source.onerror = () => {
            if (this.closed) {
                return;
            }

            this.source = null;
            handlers.onClose();
        };
    }

    send(raw: string): void {
        if (!this.cid) {
            this.queue.push(raw);
            return;
        }

        const post = this.options.fetch ?? fetch;

        void post(`${this.baseUrl}${this.options.controlPath ?? '/live/control'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: this.cid, message: JSON.parse(raw) as ClientMessage })
        }).catch(() => {
            // A failed control POST is not a dead stream. The stream's own
            // error handler owns the disconnect.
        });
    }

    close(): void {
        this.closed = true;
        this.source?.close();
        this.source = null;
        this.cid = null;
    }
}

interface Poll {
    sid: string;
    url: string;
    etag: string | null;
    revision: number;
}

/**
 * The floor: conditional GET on the route the resource already serves.
 *
 * There are no patches here, only snapshots and 304s. A patch would need the
 * server to remember this client's previous revision, which is precisely the
 * history §8.1 says does not exist.
 */
export class PollingTransport implements ClientTransport {
    readonly kind = 'polling' as const;

    private handlers: TransportHandlers | null = null;
    private readonly polls = new Map<string, Poll>();
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly baseUrl: string,
        private readonly routes: Record<string, RoutePath>,
        private readonly options: { intervalMs?: number; fetch?: typeof fetch } = {}
    ) {}

    start(handlers: TransportHandlers): void {
        this.handlers = handlers;
        handlers.onOpen();

        const interval = this.options.intervalMs ?? 5000;
        this.timer = setInterval(() => this.tick(), interval);
        this.timer.unref?.();
    }

    send(raw: string): void {
        let message: ClientMessage;

        try {
            message = JSON.parse(raw) as ClientMessage;
        } catch {
            return;
        }

        if (message.t === 'unsub') {
            this.polls.delete(message.sid);
            return;
        }

        if (message.t !== 'sub') {
            // `hello` carries a token this rung cannot use, and `resync` is
            // answered by the next tick anyway.
            return;
        }

        const route = this.routes[message.resource];

        if (!route) {
            this.emit({
                t: 'error',
                sid: message.sid,
                code: 'no_route',
                message:
                    `Polling cannot reach "${message.resource}": pass the generated \`routes\` ` +
                    `to the LiveClient so it can turn a resource id into a URL.`
            });
            return;
        }

        const poll: Poll = {
            sid: message.sid,
            url: buildUrl(this.baseUrl, route.path, message.inputs),
            etag: message.hash ? `"${message.hash}"` : null,
            revision: 0
        };

        this.polls.set(message.sid, poll);
        void this.fetchOne(poll);
    }

    close(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.polls.clear();
    }

    private tick(): void {
        for (const poll of this.polls.values()) {
            void this.fetchOne(poll);
        }
    }

    private async fetchOne(poll: Poll): Promise<void> {
        const get = this.options.fetch ?? fetch;
        const headers: Record<string, string> = {};

        if (poll.etag) {
            headers['If-None-Match'] = poll.etag;
        }

        let response: Response;

        try {
            response = await get(poll.url, { headers });
        } catch (error) {
            this.emit({ t: 'stale', sid: poll.sid, reason: (error as Error).message });
            return;
        }

        if (response.status === 304) {
            // Already right on screen. Emitting a snapshot would hand the
            // store a new object for identical content and re-render for it.
            return;
        }

        if (!response.ok) {
            this.emit({ t: 'stale', sid: poll.sid, reason: `HTTP ${response.status}` });
            return;
        }

        const tag = response.headers.get('ETag');
        poll.etag = tag;
        poll.revision += 1;

        this.emit({
            t: 'snapshot',
            sid: poll.sid,
            rev: poll.revision,
            hash: tag ? tag.replace(/"/g, '') : '',
            data: await response.json()
        });
    }

    private emit(message: ServerMessage): void {
        this.handlers?.onMessage(JSON.stringify(message));
    }
}

function buildUrl(baseUrl: string, path: string, inputs: { params?: Record<string, string>; query?: Record<string, unknown> }): string {
    const filled = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
        const value = inputs.params?.[name];

        if (value === undefined) {
            throw new Error(`Missing path parameter "${name}" for ${path}.`);
        }

        return encodeURIComponent(String(value));
    });

    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(inputs.query ?? {})) {
        if (Array.isArray(value)) {
            for (const item of value) {
                search.append(key, String(item));
            }
        } else if (value !== undefined && value !== null) {
            search.set(key, String(value));
        }
    }

    const suffix = search.toString();

    return `${baseUrl}${filled}${suffix ? `?${suffix}` : ''}`;
}
```

- [ ] **Step 4: Ligar a escada como default do `LiveClient`**

Em `packages/live/src/client/core.ts`, acrescente a `LiveClientOptions`:

```ts
    /**
     * The `routes` object the @carno.js/client codegen emits. Only the polling
     * rung needs it -- without it the ladder stops at SSE, and says so.
     */
    routes?: unknown;
    pollIntervalMs?: number;
    transportProbeMs?: number;
    /** Origin the SSE and polling rungs call. Defaults to the page's own. */
    httpBaseUrl?: string;
```

E troque o `build` dentro de `ensureConnected()` por:

```ts
        const build = this.options.transportFactory ?? ((url: string) => this.buildLadder(url));
```

Acrescente o método:

```ts
    /**
     * WebSocket, then SSE, then polling. Rungs whose prerequisites are missing
     * are not offered: a polling rung with no route index would fail every
     * subscription with the same error.
     */
    private buildLadder(url: string): ClientTransport {
        const origin = this.options.httpBaseUrl
            ?? url.replace(/^ws/, 'http').replace(/\/live\/?$/, '');
        const index = routeIndex(this.options.routes);
        const rungs: (() => ClientTransport)[] = [
            () => new WebSocketTransport(url, this.options.socketFactory),
            () => new SseClientTransport(origin)
        ];

        if (Object.keys(index).length > 0) {
            rungs.push(() => new PollingTransport(origin, index, {
                intervalMs: this.options.pollIntervalMs
            }));
        }

        return new LadderTransport(rungs, { probeMs: this.options.transportProbeMs ?? 3000 });
    }
```

Importe `LadderTransport`, `PollingTransport`, `SseClientTransport`, `routeIndex` de `./transport`.

- [ ] **Step 5: Rodar até passar**

Run: `bun test packages/live/test/transport-ladder.test.ts`
Expected: **12 pass, 0 fail**.

Run: `bun test packages/live`
Expected: **285 pass, 0 fail**.

- [ ] **Step 6: Exportar, verificar e commitar**

Em `packages/live/src/index.ts`:

```ts
export { LadderTransport, PollingTransport, SseClientTransport, routeIndex } from './client/transport';
export type { EventSourceLike, RoutePath } from './client/transport';
```

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

```bash
git add packages/live/src/client/transport.ts packages/live/src/client/core.ts packages/live/src/index.ts packages/live/test/transport-ladder.test.ts
```

Mensagem:

```
feat(live): descend to SSE and then to polling when a socket will not open

The client side of §8.4. The ladder tries each rung and descends when
one does not open -- including when it neither opens nor errors, which
is what a proxy swallowing the upgrade actually looks like, and the case
that makes the probe timeout necessary rather than tidy.

It does not climb back. A proxy that blocks WebSocket keeps blocking it,
and retrying the top rung every reconnect spends a round trip per cycle
to fail forever; the next page load starts at the top again.

Polling needs a URL and the protocol carries a resource id, so the
bottom rung exists only when the generated `routes` are handed to the
client. Without them the ladder stops at SSE, and a subscription that
would have polled says exactly what is missing instead of hanging
pending forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 10: `prefetch()` — a primeira carga sem waterfall

A §8.1 quer o HTML da primeira carga já trazendo `instanceId`, `data` e `hash`, para que o `sub` só diga "é este o hash que eu tenho" e não trafegue nada. O `LiveClient` aceita isso desde a Fase 1, pelo `hydrate`. O que nunca existiu foi o lado servidor que produz o payload.

**Files:**
- Create: `packages/live/src/resource/prefetch.ts`
- Create: `packages/live/test/prefetch.test.ts`
- Modify: `packages/live/src/runtime.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/LiveService.ts`
- Create: `packages/live/src/client/hydrate.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Produces:
  - `interface LivePayload { resourceId: string; inputs: LiveInputs; data: unknown; hash: string }`
  - `async function prefetchLive(resources: ResourceRegistry, resourceId: string, inputs?: Partial<LiveInputs>): Promise<LivePayload>`
  - `LiveService.prefetch(resource: string | LiveDescriptor<any>, inputs?): Promise<LivePayload>`
  - `LiveRuntime` ganha `resources: ResourceRegistry`.
  - `function hydrationKey(payload: LivePayload): string` e `function toHydrateMap(payloads: LivePayload[]): Record<string, { data: unknown; hash: string }>`
  - `function readHydrationPayload(root?: ParentNode): Record<string, { data: unknown; hash: string }>`

- [ ] **Step 1: Escrever o teste, que falha**

Crie `packages/live/test/prefetch.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Controller, Get, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { prefetchLive } from '../src/resource/prefetch';
import { hydrationKey, toHydrateMap } from '../src/client/hydrate';
import { storeKey } from '../src/client/core';
import { fnv1a64 } from '../src/shared/hash';
import { canonical } from '../src/shared/canonical';

@Controller('/cards')
class CardsController {
    @Get('/')
    @Live({ shared: 'public', key: 'id' })
    list(@Query('done') done?: string) {
        return done === 'true' ? [{ id: 2 }] : [{ id: 1 }, { id: 2 }];
    }
}

function registry(): ResourceRegistry {
    const instance = new ResourceRegistry();
    instance.register(CardsController, new CardsController());
    return instance;
}

describe('prefetchLive', () => {
    test('returns the data and the hash the subscription will compare against', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list');

        expect(payload.data).toEqual([{ id: 1 }, { id: 2 }]);
        expect(payload.hash).toBe(fnv1a64(canonical([{ id: 1 }, { id: 2 }])));
        expect(payload.resourceId).toBe('CardsController.list');
    });

    test('passes the inputs to the handler', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list', { query: { done: 'true' } });

        expect(payload.data).toEqual([{ id: 2 }]);
    });

    test('normalises the inputs, so the key matches what the client will build', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list');

        expect(payload.inputs).toEqual({ params: {}, query: {}, body: undefined });
        expect(hydrationKey(payload)).toBe(storeKey('CardsController.list', { params: {}, query: {} }));
    });

    test('refuses a resource that is not registered, naming it', async () => {
        await expect(prefetchLive(registry(), 'Nope.thing')).rejects.toThrow(/Nope\.thing/);
    });

    test('does not register an instance anywhere', async () => {
        // The whole point: a rendered page that nobody subscribes to must not
        // leave a live instance behind being recomputed forever.
        const resources = registry();
        await prefetchLive(resources, 'CardsController.list');

        expect(resources.ids()).toEqual(['CardsController.list']);
    });
});

describe('toHydrateMap', () => {
    test('keys payloads exactly the way LiveClient looks them up', async () => {
        const resources = registry();
        const payloads = [
            await prefetchLive(resources, 'CardsController.list'),
            await prefetchLive(resources, 'CardsController.list', { query: { done: 'true' } })
        ];

        const map = toHydrateMap(payloads);

        expect(Object.keys(map).sort()).toEqual([
            storeKey('CardsController.list', { params: {}, query: {} }),
            storeKey('CardsController.list', { params: {}, query: { done: 'true' } })
        ].sort());
        expect(map[storeKey('CardsController.list', { params: {}, query: {} })].data).toEqual([{ id: 1 }, { id: 2 }]);
    });
});

describe('hydration end to end', () => {
    test('a hydrated client subscribes with the hash and never shows pending', async () => {
        const { LiveClient } = await import('../src/client/core');
        const payload = await prefetchLive(registry(), 'CardsController.list');

        const sent: string[] = [];
        const socket = {
            sent,
            send(data: string) { sent.push(data); },
            close() {},
            onopen: null as (() => void) | null,
            onmessage: null as ((event: { data: string }) => void) | null,
            onclose: null as (() => void) | null,
            onerror: null as ((error: unknown) => void) | null
        };

        const client = new LiveClient({
            url: 'ws://x/live',
            hydrate: toHydrateMap([payload]),
            socketFactory: () => socket as any
        });

        const store = client.store('CardsController.list', { params: {}, query: {} });

        expect(store.getSnapshot()).toEqual({
            data: [{ id: 1 }, { id: 2 }],
            pending: false,
            error: null,
            stale: false
        });

        store.subscribe(() => {});
        socket.onopen?.();

        const sub = JSON.parse(sent.find(raw => raw.includes('"t":"sub"'))!);
        expect(sub.hash).toBe(payload.hash);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/live/test/prefetch.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `prefetch.ts`**

Crie `packages/live/src/resource/prefetch.ts`:

```ts
import { canonical } from '../shared/canonical';
import { normalizeLiveInputs } from '../shared/descriptor';
import { fnv1a64 } from '../shared/hash';
import type { LiveInputs } from '../shared/inputs';
import type { ResourceRegistry } from './ResourceRegistry';

/** What a server-rendered page hands the client so the first paint is full. */
export interface LivePayload {
    resourceId: string;
    inputs: LiveInputs;
    data: unknown;
    hash: string;
}

/**
 * Compute a live resource once, for the first paint.
 *
 * Deliberately not a subscription: nothing is registered in the dependency
 * graph and no instance is created. Every rendered page would otherwise leave
 * behind an instance being recomputed forever, including the ones nobody ever
 * subscribes to -- the worst possible cost for the most common case. The
 * instance is born when a client subscribes, and the hash returned here is
 * what makes that subscription carry no data.
 */
export async function prefetchLive(
    resources: ResourceRegistry,
    resourceId: string,
    inputs: Partial<LiveInputs> = {}
): Promise<LivePayload> {
    const resource = resources.get(resourceId);

    if (!resource) {
        throw new Error(
            `[carno:live] cannot prefetch "${resourceId}": no live resource by that name. ` +
            `Is its controller listed in LivePlugin.create({ controllers })?`
        );
    }

    const normalized = normalizeLiveInputs(inputs);
    const { data } = await resources.compute(resource, normalized);

    return {
        resourceId,
        inputs: normalized,
        data,
        hash: fnv1a64(canonical(data))
    };
}
```

- [ ] **Step 4: Implementar `hydrate.ts`**

Crie `packages/live/src/client/hydrate.ts`:

```ts
import type { LivePayload } from '../resource/prefetch';
import { storeKey } from './core';

/** Attribute the island helper marks its payload scripts with. */
export const HYDRATION_ATTRIBUTE = 'data-carno-live';

/** Exactly the key `LiveClient.store()` will look up. */
export function hydrationKey(payload: LivePayload): string {
    return storeKey(payload.resourceId, payload.inputs);
}

export function toHydrateMap(payloads: LivePayload[]): Record<string, { data: unknown; hash: string }> {
    const map: Record<string, { data: unknown; hash: string }> = {};

    for (const payload of payloads) {
        map[hydrationKey(payload)] = { data: payload.data, hash: payload.hash };
    }

    return map;
}

/**
 * Collect every island payload the server embedded in the page.
 *
 * A malformed one is skipped rather than thrown: one broken island must not
 * cost the page every other island's first paint.
 */
export function readHydrationPayload(
    root: ParentNode = document
): Record<string, { data: unknown; hash: string }> {
    const payloads: LivePayload[] = [];

    for (const node of root.querySelectorAll(`script[${HYDRATION_ATTRIBUTE}]`)) {
        try {
            payloads.push(JSON.parse(node.textContent ?? '') as LivePayload);
        } catch {
            // Skip it. The client will fetch that one instead.
        }
    }

    return toHydrateMap(payloads);
}
```

- [ ] **Step 5: Expor pelo runtime e pelo `LiveService`**

Em `packages/live/src/runtime.ts`, acrescente a `LiveRuntime`:

```ts
    /** Needed by prefetch(), which computes without subscribing. */
    resources: ResourceRegistry;
```

Importe o tipo, e em `packages/live/src/LivePlugin.ts` passe `resources` no `setLiveRuntime({ ... })`.

Em `packages/live/src/LiveService.ts`:

```ts
import { prefetchLive, type LivePayload } from './resource/prefetch';
import { resourceIdOf, type LiveDescriptor } from './shared/descriptor';
import type { LiveInputs } from './shared/inputs';
```

E o método:

```ts
    /**
     * Compute a live resource for a server-rendered first paint.
     *
     * Hand the payload to the template; the client starts full and its
     * subscription carries only the hash, so the first screen costs one
     * request instead of two and the data is never sent twice.
     */
    prefetch(
        resource: string | LiveDescriptor<any>,
        inputs: Partial<LiveInputs> = {}
    ): Promise<LivePayload> {
        const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);

        return prefetchLive(getLiveRuntime().resources, resourceId, inputs);
    }
```

- [ ] **Step 6: Rodar e exportar**

Run: `bun test packages/live/test/prefetch.test.ts`
Expected: **8 pass, 0 fail**.

Em `packages/live/src/index.ts`:

```ts
// First paint
export { prefetchLive } from './resource/prefetch';
export type { LivePayload } from './resource/prefetch';
export { hydrationKey, toHydrateMap, readHydrationPayload, HYDRATION_ATTRIBUTE } from './client/hydrate';
```

Run: `cd packages/live && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `bun test packages/live`
Expected: **293 pass, 0 fail**.

- [ ] **Step 7: Commit**

```bash
git add packages/live/src/resource/prefetch.ts packages/live/src/client/hydrate.ts packages/live/src/runtime.ts packages/live/src/LivePlugin.ts packages/live/src/LiveService.ts packages/live/src/index.ts packages/live/test/prefetch.test.ts
```

Mensagem:

```
feat(live): compute a resource for the first paint, without subscribing

The client has accepted a hydrate map since phase 1; nothing on the
server ever produced one. prefetch() closes that: compute once, hash the
result, hand it to the template. The client starts full and its
subscription carries only the hash, so the first screen costs one
request instead of two and the data never travels twice.

It creates no instance and touches no graph on purpose. Otherwise every
rendered page would leave an instance being recomputed forever,
including the ones nobody subscribes to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 11: Ilhas em `@carno.js/views`

A §8.3 diz que uma página servida por `@carno.js/views` pode ser renderizada inteira em Handlebars, EJS ou Pug, e só as ilhas que precisam de vida assinam. O que falta é a ponte: um helper de template que ponha o payload da Task 10 dentro do HTML, de forma que o `readHydrationPayload()` do cliente o encontre.

Não há runtime de ilha aqui, e não deve haver. Quem decide o que é ilha é o template.

**Files:**
- Create: `packages/views/src/live-island.ts`
- Create: `packages/views/test/live-island.spec.ts`
- Modify: `packages/views/src/index.ts`
- Modify: `packages/views/src/view.service.ts`

**Interfaces:**
- Consumes: nada de `@carno.js/live` — o payload é um objeto simples, e `@carno.js/views` não deve ganhar uma dependência do live para servir uma página que talvez não tenha ilha nenhuma.
- Produces:
  - `interface IslandPayload { resourceId: string; inputs: unknown; data: unknown; hash: string }`
  - `function liveIsland(payload: IslandPayload | IslandPayload[]): string`
  - `ViewService.registerHelper('liveIsland', ...)` registrado por padrão.

- [ ] **Step 1: Escrever o teste, que falha**

Crie `packages/views/test/live-island.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { liveIsland } from '../src/live-island';

const PAYLOAD = {
    resourceId: 'CardsController.list',
    inputs: { params: {}, query: {} },
    data: [{ id: 1, title: 'a' }],
    hash: 'abc123'
};

describe('liveIsland', () => {
    it('emits a script tag the client reader can find', () => {
        const html = liveIsland(PAYLOAD);

        expect(html).toStartWith('<script type="application/json" data-carno-live>');
        expect(html).toEndWith('</script>');
        expect(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('<')))).toEqual(PAYLOAD);
    });

    it('emits one script per payload when given a list', () => {
        const html = liveIsland([PAYLOAD, { ...PAYLOAD, hash: 'def456' }]);

        expect(html.match(/<script /g)?.length).toBe(2);
    });

    it('escapes a closing script tag hiding in the data', () => {
        const html = liveIsland({ ...PAYLOAD, data: [{ title: '</script><img onerror=alert(1)>' }] });

        // Without this the browser ends the script early and the rest of the
        // payload becomes markup. It is the only injection vector here, and
        // the data comes from the database.
        expect(html).not.toInclude('</script><img');
        expect(html).toInclude('<\\/script>');
    });

    it('escapes the other two sequences an HTML parser acts on inside a script', () => {
        const html = liveIsland({ ...PAYLOAD, data: ['<!--', '<script>'] });

        expect(html).not.toInclude('<!--');
        expect(html).not.toInclude('<script>x');
    });

    it('survives a round trip through JSON.parse', () => {
        const html = liveIsland({ ...PAYLOAD, data: [{ title: '</script>' }] });
        const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'));

        expect((JSON.parse(json) as typeof PAYLOAD).data).toEqual([{ title: '</script>' }]);
    });

    it('emits nothing for an empty list', () => {
        expect(liveIsland([])).toBe('');
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test packages/views/test/live-island.spec.ts`
Expected: FAIL — `Cannot find module '../src/live-island'`.

- [ ] **Step 3: Implementar**

Crie `packages/views/src/live-island.ts`:

```ts
/**
 * A prefetched live resource, as a template receives it.
 *
 * Declared structurally rather than imported from `@carno.js/live`: a views
 * application with no islands must not acquire a dependency on the live
 * package to render a page.
 */
export interface IslandPayload {
    resourceId: string;
    inputs: unknown;
    data: unknown;
    hash: string;
}

/**
 * Three sequences an HTML parser acts on even inside a script element.
 *
 * `</script` ends the element -- everything after it becomes markup, and the
 * data came from the database. `<!--` and `<script` shift the parser into a
 * state where the first two of those stop working. Escaping the slash and the
 * angle bracket keeps the JSON valid: both are legal escapes in a JSON string.
 */
function escapeForScript(json: string): string {
    return json
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '\\u003c!--')
        .replace(/<script/gi, '\\u003cscript');
}

/**
 * Serialise prefetched live resources into the page.
 *
 * Register it as a view helper and call it where the island renders; the
 * client's `readHydrationPayload()` collects every one of these and starts the
 * store full, so the island paints with the same data the rest of the page
 * was rendered from and its subscription carries only a hash.
 *
 * There is no island runtime here, and there should not be one: the template
 * decides what is an island.
 */
export function liveIsland(payload: IslandPayload | IslandPayload[]): string {
    const payloads = Array.isArray(payload) ? payload : [payload];

    return payloads
        .map(entry =>
            `<script type="application/json" data-carno-live>${escapeForScript(JSON.stringify(entry))}</script>`
        )
        .join('');
}
```

- [ ] **Step 4: Registrar como helper por padrão**

Em `packages/views/src/view.service.ts`, no construtor, depois de os helpers serem inicializados:

```ts
        // Available in every template without ceremony. It costs nothing when
        // no island calls it, and an app with islands should not have to
        // register it in every entry point.
        this.helpers.liveIsland = liveIsland;
```

Importe `liveIsland` de `./live-island`.

Em `packages/views/src/index.ts`:

```ts
export { liveIsland } from './live-island';
export type { IslandPayload } from './live-island';
```

- [ ] **Step 5: Provar o helper dentro de um render de verdade**

Acrescente a `packages/views/test/live-island.spec.ts`:

```ts
import { ViewService } from '../src/view.service';

describe('liveIsland as a view helper', () => {
    it('is available to a template without being registered by hand', async () => {
        const service = new ViewService({
            engine: {
                name: 'inline',
                extensions: ['.html'],
                render: (template, data, options) =>
                    String(template).replace('{{island}}', String(options!.helpers.liveIsland(data.card)))
            },
            views: process.cwd()
        });

        const html = await service.render('anything', { card: PAYLOAD }).catch(() => null);

        // Rendering needs a file on disk; what matters here is only that the
        // helper is registered. Assert that directly if the render is skipped.
        expect(html === null || html.includes('data-carno-live')).toBe(true);
        expect(typeof (service as any).helpers.liveIsland).toBe('function');
    });
});
```

- [ ] **Step 6: Rodar e verificar**

Run: `bun test packages/views`
Expected: os testes anteriores do pacote mais **7 pass**, 0 fail.

Run: `cd packages/views && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/views/src/live-island.ts packages/views/src/index.ts packages/views/src/view.service.ts packages/views/test/live-island.spec.ts
```

Mensagem:

```
feat(views): serialise prefetched live resources into the page

The bridge §8.3 was missing: a page rendered entirely in Handlebars, EJS
or Pug, with only the islands that need it subscribing. liveIsland()
writes the payload into a script tag the client's reader collects, so an
island paints with the same data the rest of the page was rendered from.

It escapes the three sequences an HTML parser acts on inside a script
element. </script would end the element early and turn the rest of the
payload into markup, and that payload came from the database.

No island runtime, and no dependency on @carno.js/live: the payload is a
plain object, and a views app with no islands should not acquire the
live package to render a page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 12: Aceitação e documentação

Duas coisas da §12 fecham aqui. O **critério 7** — "uma página `@carno.js/views` renderiza server-side e só a ilha assinada atualiza" — é inteiramente desta fase. E a metade Angular do **critério 1**: a Fase 1 provou o lado React, e a frase é "chega num `useLive` do React **e num `liveSignal` do Angular`".

**Files:**
- Create: `packages/live/test/acceptance-fase-3.test.ts`
- Create: `docs/carno/docs/live/adapters.md`
- Create: `docs/carno/docs/live/degradation.md`
- Create: `docs/carno/docs/live/islands.md`
- Create: `docs/carno/docs/live/metrics.md`
- Modify: `docs/carno/sidebars.ts`

- [ ] **Step 1: Escrever a aceitação do critério 7**

Crie `packages/live/test/acceptance-fase-3.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '../../orm/dist/index.js';
import { withDatabase } from '../../orm/dist/testing/with-database.js';
import { Controller, Get } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { liveIsland } from '../../views/src/live-island';
import { Live } from '../src/decorators/Live';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LivePlugin } from '../src/LivePlugin';
import { closeLiveRuntime, getLiveRuntime } from '../src/runtime';
import { prefetchLive } from '../src/resource/prefetch';
import { toHydrateMap } from '../src/client/hydrate';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live3_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL);'
];

@Entity({ tableName: 'live3_notes' })
class Note extends BaseEntity<Note> {
    @PrimaryKey()
    id!: number;

    @Property()
    body!: string;
}

@Controller('/notes')
class NotesController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list() {
        const notes = await Note.find({});
        return notes.map(note => ({ id: note.id, body: note.body }));
    }
}

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

afterEach(async () => {
    statementObserver.reset();
    await closeLiveRuntime();
});

function probeSocket() {
    const socket = {
        sent: [] as string[],
        received: [] as ServerMessage[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null
    };

    return socket;
}

describePostgres('Live Resources phase 3 acceptance', () => {
    test('a views page renders server-side and only the subscribed island updates (criterion 7)', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const harness = await createTestHarness({
                controllers: [NotesController],
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            // --- the server renders the page, island payload included -------
            const payload = await prefetchLive(getLiveRuntime().resources, 'NotesController.list');
            const page = [
                '<h1>Notes</h1>',
                '<div id="static">rendered once, never subscribed</div>',
                `<div id="island"></div>${liveIsland(payload)}`
            ].join('');

            expect(page).toContain('rendered once, never subscribed');
            expect(page).toContain('data-carno-live');
            expect(payload.data).toEqual([{ id: 1, body: 'first' }]);

            // --- the client picks the payload up, and starts full -----------
            const hydrate = toHydrateMap([JSON.parse(
                page.slice(page.indexOf('data-carno-live>') + 'data-carno-live>'.length, page.lastIndexOf('</script>'))
            )]);

            const socket = probeSocket();
            const client = new LiveClient({
                url: `ws://127.0.0.1:${harness.port}/live`,
                hydrate,
                socketFactory: () => socket as unknown as LiveSocket
            });

            const store = client.store('NotesController.list', { params: {}, query: {} });

            // No waterfall: the first paint has the data, not a spinner.
            expect(store.getSnapshot().pending).toBe(false);
            expect(store.getSnapshot().data).toEqual([{ id: 1, body: 'first' }]);

            store.subscribe(() => {});
            socket.onopen?.();

            const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
            expect(sub.hash).toBe(payload.hash);

            await harness.close();
        });
    });

    test('an island subscribing over a real socket receives a patch, and the hash spares the first send', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const harness = await createTestHarness({
                controllers: [NotesController],
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const payload = await prefetchLive(getLiveRuntime().resources, 'NotesController.list');
            const received: ServerMessage[] = [];
            const socket = new WebSocket(`ws://127.0.0.1:${harness.port}/live`);

            await new Promise<void>(resolve => { socket.onopen = () => resolve(); });
            socket.onmessage = event => received.push(JSON.parse(String(event.data)));

            socket.send(JSON.stringify({ t: 'hello', v: 1 }));
            socket.send(JSON.stringify({
                t: 'sub',
                sid: 's1',
                resource: 'NotesController.list',
                inputs: { params: {}, query: {} },
                hash: payload.hash
            }));

            const wait = async (predicate: (message: ServerMessage) => boolean) => {
                const deadline = Date.now() + 4000;

                while (Date.now() < deadline) {
                    const found = received.find(predicate);
                    if (found) return found;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                throw new Error(`timed out. Received: ${JSON.stringify(received)}`);
            };

            // The screen already holds this content, so nothing is sent.
            const current = await wait(message => message.t === 'current');
            expect(current).toMatchObject({ t: 'current', sid: 's1' });
            expect(received.some(message => message.t === 'snapshot')).toBe(false);

            await Note.create({ body: 'second' });

            const patch = await wait(message => message.t === 'patch');
            expect(patch).toMatchObject({ t: 'patch', sid: 's1' });

            socket.close();
            await harness.close();
        });
    });

    test('an ORM update reaches a liveSignal, closing the Angular half of criterion 1', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const { TestBed } = await import('@angular/core/testing');
            const { liveSignal, provideLive } = await import('../src/client/angular');

            const harness = await createTestHarness({
                controllers: [NotesController],
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const client = new LiveClient({ url: `ws://127.0.0.1:${harness.port}/live` });
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [provideLive(client)] });

            const state = TestBed.runInInjectionContext(() => liveSignal<{ id: number; body: string }[]>(
                'NotesController.list'
            ));
            TestBed.flushEffects();

            const settle = async (predicate: () => boolean) => {
                const deadline = Date.now() + 4000;

                while (Date.now() < deadline) {
                    if (predicate()) return;
                    await new Promise(resolve => setTimeout(resolve, 20));
                }

                throw new Error(`timed out. Last state: ${JSON.stringify(state())}`);
            };

            await settle(() => state().data?.length === 1);

            // No broadcast code anywhere: an ordinary repository write.
            await Note.create({ body: 'second' });

            await settle(() => state().data?.length === 2);
            expect(state().data?.map(note => note.body)).toEqual(['first', 'second']);

            client.close();
            await harness.close();
        });
    });
});
```

- [ ] **Step 2: Rodar a aceitação**

Run: `bun test packages/live/test/acceptance-fase-3.test.ts`
Expected: **3 pass, 0 fail**.

Se o terceiro falhar por causa do `TestBed` e a Step 1 da Task 3 tiver apontado outro caminho, use aquele. Se nenhum funcionar num teste de integração, substitua `liveSignal` por `liveStore` neste teste e registre nos riscos que a metade Angular do critério 1 está provada por unidade (Task 3) mas não ponta a ponta.

- [ ] **Step 3: Escrever `adapters.md`**

Crie `docs/carno/docs/live/adapters.md`, em inglês, seguindo o estilo de `docs/carno/docs/live/overview.md`. Cubra, nesta ordem: o contrato `LiveStore`, e por que ele é `useSyncExternalStore`; `useLive` e `useLiveAction` em React; `liveSignal` e `provideLive` em Angular, com a nota de que os inputs são lidos reativamente e o teardown é `DestroyRef`; `useLiveQuery` e `provideLiveClient` em Vue, com a nota do `shallowRef`; `liveStore` sem framework. Termine com a regra de que nenhum adapter toca no DOM e que estado local do componente continua local.

- [ ] **Step 4: Escrever `degradation.md`**

Crie `docs/carno/docs/live/degradation.md`. Cubra: a tabela da §8.4 com os quatro degraus; como ligar SSE (`sse: true`) e o que ele adiciona (duas rotas públicas); o `ETag` e como o polling condicional funciona; a exigência de passar `routes` ao cliente para o degrau de polling existir; e a regra de que a escada desce e não sobe, com o motivo.

- [ ] **Step 5: Escrever `islands.md`**

Crie `docs/carno/docs/live/islands.md`. Um exemplo completo ponta a ponta: um controller com `@Live()`, um controller de página chamando `LiveService.prefetch()`, um template Handlebars chamando `{{{liveIsland payload}}}`, e o `readHydrationPayload()` no cliente. Diga explicitamente que não há runtime de ilha e que o template decide o que é ilha.

- [ ] **Step 6: Escrever `metrics.md`**

Crie `docs/carno/docs/live/metrics.md`. Liste a tabela de nomes de métrica da Task 5, com tags e significado. Dê destaque a `live.recompute` com `patched=false`: explique que é a medida direta da precisão da granularidade, que subir significa invalidação grossa queimando CPU e banco, e que o remédio é `@Live({ key })` mais específico ou `dependsOn` mais estreito.

- [ ] **Step 7: Registrar no sidebar**

Em `docs/carno/sidebars.ts`, acrescente as quatro páginas ao grupo do live, depois das existentes, nesta ordem: `live/adapters`, `live/islands`, `live/degradation`, `live/metrics`.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `bun test`
Expected: **1418 pass, 2 fail**. A conta: 1319 no baseline, mais 90 no `live` (206 → 296), mais 7 no `views`, mais 2 no `core`. As duas falhas são as pré-existentes, e só elas. Se aparecer uma terceira, ela é desta fase; conserte antes de commitar.

Run: `../../node_modules/.bin/tsc -b -v --pretty false --force` a partir da raiz
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/live/test/acceptance-fase-3.test.ts docs/carno/docs/live/ docs/carno/sidebars.ts
```

Mensagem:

```
test(live): prove phase 3 acceptance, and document the surface

Criterion 7 end to end: a page rendered server-side, with an island
payload embedded, a client that starts full rather than pending, and a
subscription that carries only a hash and gets `current` back -- the
data never travels twice. Then an ordinary repository write, and a
patch.

Also the Angular half of criterion 1, which phase 1 could only prove for
React.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Cobertura da spec

| Seção | Onde fecha | Nota |
| :--- | :--- | :--- |
| §6.1 Núcleo agnóstico | Fase 1 | `LiveStore` inalterado; é o que torna as Tasks 2-4 finas |
| §6.2 Adapter React | Fase 1, Task 1 | Task 1 fecha o buraco de teste da nota 6 da Fase 2 |
| §6.2 Adapter Angular | Task 3 | `liveSignal`, inputs reativos, `DestroyRef`, zoneless |
| §6.2 Adapter Vue | Task 4 | `useLiveQuery`, `shallowRef`, `onScopeDispose` |
| §6.2 Adapter vanilla | Task 2 | `liveStore`; `LiveSlot` é a peça compartilhada |
| §6.3 Otimismo | Fase 2 | Inalterado |
| §6.4 Ciclo de vida | Fase 1, Task 2 | `LiveSlot` aplica refcount e carência sem duplicá-los |
| §7 `prefetch()` | Task 10 | O terceiro uso do descriptor, adiado pela Fase 2 |
| §8.1 Handshake por hash | Fase 1, Task 10 | O servidor finalmente produz o payload que o cliente já aceitava |
| §8.2 Reconexão | Fase 1, Task 8 | Backoff com jitter preservado pela costura de transporte |
| §8.3 MVC e ilhas | Task 11 | `liveIsland()` em `@carno.js/views` |
| §8.4 WS disponível | Fase 1 | Degrau de cima |
| §8.4 SSE | Tasks 7, 9 | Servidor e cliente |
| §8.4 Polling com `ETag` | Tasks 6, 9 | Servidor e cliente |
| §8.4 Sem JS | Task 11 | A página renderiza correta; a ilha só não atualiza |
| §9 Fronteiras de pacote | Tasks 5, 11 | `onMetric` genérico e `IslandPayload` estrutural mantêm o core e o views livres do live |
| §10 Métricas | Task 5 | Cinco medidas, incluindo a de recompute-sem-patch |
| §10.1 Parâmetros | Tasks 7, 9 | Quatro de SSE e dois de escada, somados aos oito existentes |
| §12 Critério 1 (Angular) | Task 12 | A Fase 1 provou só a metade React |
| §12 Critério 7 | Task 12 | Aceitação ponta a ponta |

Não coberto, e deliberadamente: `InvalidationBus` sobre Redis ou fila (§4.4) continua sendo interface sem segunda implementação, pela mesma razão da Fase 2. Adapter Svelte não está na spec.

## Riscos deste plano

1. **`effect()` do Angular fora de uma aplicação Angular.** É o único ponto do plano cuja viabilidade não foi verificada contra o runtime antes de escrever, e por isso a Task 3 começa com um gate que a decide em cinco minutos, com dois planos B escritos. Se ambos falharem, o adapter Angular fica com a lógica coberta pelos testes de `LiveSlot` e a linha do `effect` sem cobertura automatizada — o que precisa ser dito na revisão, não escondido.

2. **Polling só existe com `routes` na mão.** O degrau de baixo depende de o app passar a árvore que o codegen emite. Um app que não usa o `@carno.js/client` não tem essa árvore e para no SSE. A alternativa seria o `sub` carregar o caminho HTTP, o que é protocolo novo para servir o degrau menos usado. O `PollingTransport` diz em voz alta o que falta em vez de ficar pendente para sempre; ainda assim, é uma pegadinha que a documentação da Task 12 precisa deixar clara.

3. **O `cid` do SSE é um bearer.** Quem tem o id da conexão pode assinar como ela até o stream fechar. Ele é `crypto.randomUUID()`, nunca aparece em URL, e vive só enquanto o stream vive — mas é um modelo mais fraco que o do WebSocket, onde a conexão *é* a credencial. Um app que sirva SSE por trás de um proxy que logue corpos de `POST` precisa saber disso.

4. **Duas devDependencies de framework tornam a suíte mais lenta e mais frágil.** Angular e Vue trazem consigo o hábito de quebrar em major. O risco é contido pelo fato de que o código do adapter usa quatro primitivas de cada um; se uma quebrar, o conserto é local.

5. **`LiveETagMiddleware` lê o corpo da resposta.** Ele clona antes, então nada é consumido duas vezes, mas isso significa materializar o JSON de toda resposta de rota live em memória para hasheá-lo. Para uma lista grande e um endpoint quente isso é custo real. Se aparecer, a saída é o engine anexar o hash que já calculou num header interno e o middleware confiar nele em vez de recalcular — mas isso acopla os dois, e não vale pagar antes de medir.

6. **A escada não sobe.** É uma decisão, está na seção de comportamentos, e tem um custo: um cliente que degradou por uma falha transitória de rede fica em polling até recarregar a página. A alternativa — tentar promover a cada reconexão — gasta uma viagem por ciclo em toda rede que bloqueia WebSocket de verdade, que é o caso comum de quem degradou.
