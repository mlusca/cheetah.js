# Live Resources — reatividade ponta a ponta no Carno.js

- **Data:** 2026-08-31
- **Status:** design aprovado, pendente de plano de implementação
- **Pacote novo:** `@carno.js/live`

## 1. Contexto e objetivo

O Carno.js hoje oferece dois caminhos de front-end: MVC server-rendered
(`@carno.js/views`) e SPA separada consumindo HTTP (`@carno.js/client`, com os
POCs em `examples/spa-react-poc` e `examples/spa-angular-poc`). Nenhum dos dois
dá reatividade: a tela só muda quando o usuário age.

O objetivo é uma camada de estado compartilhado que atravessa a rede. O
servidor é dono desse estado; o framework de front-end o consome como store
nativa (signal no Angular, `useSyncExternalStore` no React); e uma escrita no
banco propaga sozinha até a tela, sem ninguém escrever código de broadcast.

Diferencial pretendido, em uma frase: *o único framework onde um write no seu
Postgres chega sozinho no signal do seu Angular.*

Referências de mercado e por que não servem:

| Solução | Por que não |
| :--- | :--- |
| Inertia | Stateless e untyped; é navegação rápida, não reatividade |
| LiveView / Livewire | Servidor dirige o DOM; estado em memória por conexão; não se escreve React/Angular |
| Hotwire | Mesma família; HTML sobre o fio |
| Convex, Meteor, Supabase Realtime | Entregam a reatividade, mas como plataforma/banco fechado, não como framework sobre o seu Postgres |

## 2. Decisões

| # | Decisão | Escolha |
| :--- | :--- | :--- |
| D1 | Fonte da verdade do estado | Servidor |
| D2 | Autoria do front | Componentes React/Angular/Vue reais, com reatividade local preservada; servidor manda patch de **estado**, nunca DOM |
| D3 | Gatilho de recompute | Grafo de invalidação com emissores plugáveis |
| D4 | Ciclo de vida do estado | Recomputável a partir de inputs; snapshot é cache, não fonte |
| D5 | Unidade de composição | Resource (live query) declarado em método de controller |
| D6 | Mutação | Método de controller normal; invalidação propaga; otimismo opcional |
| D7 | Alcance da invalidação | Híbrido: emissor da aplicação por padrão, emissor Postgres opcional |

D2 é o que separa isso de LiveView: componentes mantêm seu próprio estado
efêmero (input focado, modal aberto, hover) e ele nunca sobe.

D7 (abordagem híbrida) foi escolhida sobre as alternativas porque o grafo não
precisa saber de onde veio a invalidação. `AppEmitter` e `PgNotifyEmitter` são
duas implementações da mesma interface, então o emissor simples pode ser
entregue primeiro sem refatoração posterior. É o mesmo padrão de extensão que o
repositório já usa em `ViewEngine`, nos drivers do ORM e nos adapters de
validação.

## 3. Não-objetivos

- Não renderizamos DOM no servidor para componentes de framework.
- Não fazemos local-first / offline / CRDT. Servidor é dono do estado.
- Não inferimos patches otimistas automaticamente.
- Não suportamos `@Live()` em handlers que escrevem.
- Não tratamos MySQL com CDC/binlog nesta iteração; nele vale só o emissor da
  aplicação.

## 4. Arquitetura

### 4.1 Conceitos

**`DepKey`** — string canônica hierárquica que nomeia um pedaço de dado:

```
orm:users            tabela
orm:users#42         linha
auth:user#42         principal
app:report:2026-08   arbitrária, emitida manualmente
```

**Instância de resource** — a unidade viva. Identidade:

```
instanceId = hash(resourceId + canonical(inputs) + scopeHash)
```

Duas abas com os mesmos inputs e o mesmo escopo compartilham uma instância: um
compute, um diff, N envios.

**Escopo** — dimensões ambientes das quais o resultado depende (identidade,
tenant). Nunca vem do cliente.

```ts
@Live()                       // default: privado; scopeHash inclui o principal
@Live({ shared: 'tenant' })   // compartilhado dentro do tenant
@Live({ shared: 'public' })   // compartilhado globalmente
```

O default é o seguro. Compartilhar é otimização e se declara. Sem declaração, o
pior caso é gastar CPU a mais; jamais mostrar dado de outro usuário.

### 4.2 O grafo

Duas estruturas, e só:

```
Map<DepKey, Set<InstanceId>>
Map<InstanceId, Set<ConnectionId>>
```

O grafo não conhece WebSocket nem ORM. A instância guarda o último snapshot
**como cache**; se ele não existir (nó novo, deploy, evicção), recomputa dos
inputs e envia estado cheio. É por isso que derrubar um nó não perde nada.

### 4.3 Granularidade da invalidação

**Resolução por ancestral.** A leitura registra a chave mais específica que
conseguir provar; a escrita emite a mais específica que souber; o grafo acorda a
chave emitida e todos os seus ancestrais.

- `getUser(42)` registra `orm:users#42`
- `list({status})` registra `orm:users`
- `UPDATE users SET ... WHERE id = 42` emite `orm:users#42` → acorda os dois
- `UPDATE users SET ... WHERE created_at < X` emite `orm:users` → acorda todos abaixo

Não comparamos predicados: no caso geral é indecidível. Degradamos pro
ancestral. Como recompute que não muda nada **não gera patch**, invalidação
grossa custa CPU, nunca tráfego nem re-render.

**Filtro por coluna, ortogonal.** `Statement` já carrega `columns`. A
dependência guarda as colunas lidas, a invalidação carrega as escritas;
interseção vazia ignora. Mata o falso-positivo de `updated_at`/`last_seen_at`
batendo constantemente.

**Joins entram inteiros.** `Statement.joins` existe; um resource que lê
`users JOIN orders` depende das duas tabelas.

**Guarda de cardinalidade.** Leitura que produziria mais chaves de linha que
`maxKeysPerRead` colapsa pro ancestral. Memória do grafo limitada por design.

**Regra inegociável: correção ganha de precisão.** Chave que não dá pra provar
degrada pro ancestral, nunca pra chave nenhuma.

**Furo conhecido — SQL cru.** `driver.executeSql()` passa por fora do
`SqlBuilder` e não produz `Statement`, logo não produz chave. Um resource que
use SQL cru congelaria silenciosamente. Mitigação: compute que rodou SQL cru sem
`dependsOn` declarado é **erro em dev, warn em prod**. `@Live({ dependsOn: [...] })`
é a saída explícita.

### 4.4 Emissores

Interface única; o grafo não distingue a origem.

| Emissor | Origem | Alcance | Custo |
| :--- | :--- | :--- | :--- |
| `AppEmitter` | `SqlBuilder.execute()` no write | escritas via `@carno.js/orm` | zero infra |
| `PgNotifyEmitter` | trigger + `LISTEN/NOTIFY` | **qualquer** escrita: outro serviço, migration, psql, legado | triggers como migration |
| `LiveService.invalidate()` | manual | qualquer lugar (job, webhook, controller) | zero |

O emissor Postgres produz `tabela + PK` a partir do trigger — **o mesmo
vocabulário de chave** do emissor da aplicação. Os dois falam a mesma língua sem
tradutor. `PgNotifyEmitter` é opt-in por config e habilitável **por tabela**.

Entre nós do cluster, invalidações trafegam por um `InvalidationBus`
(`InProcess` | `Queue` | `Redis` | `PgNotify`).

### 4.5 Protocolo

Cliente → servidor: `sub`, `unsub`, `resync`.
Servidor → cliente: `snapshot`, `current`, `patch`, `stale`, `error`.

- `snapshot` — estado cheio, com revisão e hash de conteúdo.
- `current` — resposta a um `sub`/`resync` cujo hash bate com o computado; corpo vazio (ver 8.1).
- `patch` — ops de `from` para `to`.
- `stale` — o servidor não consegue garantir atualidade da instância (recompute falhando, emissor caído). O cliente segue exibindo o último dado e marca `stale: true` no `LiveState`, para a UI poder sinalizar.
- `error` — subscrição inválida ou não autorizada; encerra a instância no cliente.

Cada instância tem revisão monotônica; `patch` carrega `from`/`to`. Buraco na
sequência → `resync` → `snapshot` cheio. Perda de mensagem, reconexão e deploy
viram o mesmo problema com o mesmo caminho de solução.

Três regras de comportamento sob carga:

1. **Recompute ≠ patch.** Resultado igual não gera tráfego.
2. **Coalescing por janela `coalesceMs`.** Um `bulkUpdate` de 500 linhas vira um patch.
3. **Backpressure colapsa.** Cliente com mais de `maxPendingPatches` acumulados descarta os pendentes e recebe snapshot. Fila nunca cresce sem limite.

### 4.6 Patches com chave

O `PatchEngine` emite ops com chave quando o resource declara uma:

```ts
@Get('/') @Live({ key: 'id' })
```

Sem chave, diff de array é posicional: inserir no topo remonta a lista inteira,
o usuário perde foco de input e animações reiniciam. Com chave, o patch é
`upsert(42)` / `remove(7)` / `reorder`, e `key` do React e `trackBy` do Angular
permanecem estáveis. Array de objetos com `id` e sem `key` declarada → warn em dev.

Aplicar patch produz **nova raiz com compartilhamento estrutural** dos
sub-objetos intocados. Isso é requisito, não otimização: `useSyncExternalStore`
exige `getSnapshot()` referencialmente estável entre renders, e sem isso o React
entra em loop. Como efeito, `React.memo`, `OnPush` e igualdade de signal passam a
filtrar corretamente e só a linha alterada re-renderiza.

## 5. API do servidor

### 5.1 `@Live()` torna assinável uma rota existente

```ts
@Controller('/users')
export class UsersController {
    constructor(private readonly users: UserRepository) {}

    @Get('/')
    @Live({ key: 'id' })
    list(@Query('status') status: string): Promise<UserDto[]> {
        return this.users.findBy({ status });
    }

    @Get('/:id')
    @Live({ shared: 'tenant' })
    get(@Param('id') id: number): Promise<UserDto> {
        return this.users.findOne(id);
    }

    @Post('/')
    create(@Body() dto: CreateUserDto) {
        return this.users.create(dto);   // invalida sozinho
    }
}
```

Um método, dois modos de consumo. `GET /users?status=active` continua
respondendo JSON pra curl, SSR, mobile e Postman, passando pelos middlewares,
CORS, validação, cache e observabilidade existentes. Não existe universo live
paralelo ao HTTP.

### 5.2 Verbos permitidos

`@Live()` vale em **`@Get()` e `@Post()`** — os dois verbos que a web usa para
leitura. O `POST` cobre queries cujos inputs não cabem em query string (filtro
com muitos critérios, relatório com parâmetros aninhados); nele `@Body()` é
input de primeira classe.

Proibido em `@Put`/`@Patch`/`@Delete`: não por impossibilidade técnica, mas
porque um `PUT` que só lê é abuso de protocolo e não vale a superfície de API.

O critério real não é o verbo, é **idempotência**: assinar significa reexecutar
a função quando o dado mudar, e reexecutar uma escrita duplica efeito colateral.

### 5.3 Inputs não são assinados — são autorizados

Inputs são a query string (ou o body do `POST`). São untrusted pelo mesmo motivo
que qualquer `GET` é, e a resposta é a mesma: a subscrição passa pela mesma
cadeia de middleware/guard da rota. Assinatura seria cerimônia dando falsa
sensação de segurança.

Identidade (`userId`, `tenantId`) vem do contexto e entra no `scopeHash`, nunca
nos inputs.

### 5.4 Autorização que continua valendo depois do `sub`

O principal é uma dependência como outra: a instância depende de `auth:user#42`.
A autorização é reavaliada a cada recompute, e mudança de permissão invalida
essa chave, forçando reavaliação e derrubando a subscrição se ela não passar
mais. Sem mecanismo novo, sem heartbeat, sem TTL arbitrário.

### 5.5 Invalidação explícita

```ts
@Service()
export class ReportJob {
    constructor(private readonly live: LiveService) {}

    @Cron('0 * * * *')
    async run() {
        await this.rebuild();
        this.live.invalidate('app:report:current');
    }
}
```

### 5.6 Validações

Startup recusa (o core já compila tudo no boot):

- `@Live()` fora de `@Get`/`@Post`;
- `@Req()` ou `@Ctx()` em live resource — quebram D4;
- input com tipo não serializável — impede hash de instância;
- colisão de `resourceId`.

Runtime, no choke point do `SqlBuilder`: **escrita durante um compute é erro.**
Resource lê; ação escreve. Isso pega inclusive o `@Get()` que escreve por engano.

## 6. Cliente e adapters

**Nenhum adapter toca no DOM.** O servidor manda dados; quem renderiza é o
framework. O estado servidor entra como mais uma store, ao lado do `useState` e
do `signal()` que o componente já tem.

### 6.1 Núcleo agnóstico

`@carno.js/live/client` cuida de conexão, protocolo, revisões, resync, dedupe
por refcount, hash canônico de inputs e a pilha otimista. Expõe uma interface:

```ts
interface LiveStore<T> {
    subscribe(listener: () => void): () => void;
    getSnapshot(): LiveState<T>;   // { data, pending, error, stale }
}
```

É a assinatura de `useSyncExternalStore`, e o formato que `signal`,
`shallowRef` e store do Svelte envolvem em poucas linhas. Adapter que cresce é
sinal de lógica vazando do núcleo.

### 6.2 Adapters

```tsx
function UserList({ status }: Props) {
    const { data, stale } = useLive(api.users.list, { status });
    const [selected, setSelected] = useState<number | null>(null);  // local
    return <List items={data} selected={selected} onSelect={setSelected} dimmed={stale} />;
}
```

```ts
export class UserListComponent {
    status = signal<Status>('active');
    users = liveSignal(api.users.list, () => ({ status: this.status() }));
    selected = signal<number | null>(null);   // local
}
```

No Angular os inputs são um `computed`: mudar `status()` reassina e cancela a
anterior; teardown por `DestroyRef`; funciona zoneless.

Ordem de entrega dos adapters: React, Angular, Vue, vanilla.

### 6.3 Otimismo como overlay

```ts
const create = useLiveAction(api.users.create, {
    optimistic: [
        { on: api.users.list, apply: (draft, dto) => draft.push({ ...dto, id: tempId() }) },
    ],
});
```

O alvo é nomeado porque uma ação pode afetar vários resources, ou nenhum que a
tela assine; sem nomear, `draft` só poderia ser `any`. Com `on`, `draft` é
`UserDto[]` e `dto` é `CreateUserDto`, ambos inferidos dos descriptors.

O patch otimista vive numa **camada acima** do snapshot confirmado, nunca dentro
dele. Assim, um patch do servidor chegando com a ação em voo se aplica ao
snapshot confirmado e o overlay é reprojetado por cima. Se o otimismo mutasse o
snapshot, esse patch concorrente sobrescreveria a expectativa local e a UI
piscaria. Overlay some na confirmação ou no erro.

### 6.4 Ciclo de vida da subscrição

Refcount por instância. Chegou a zero → `unsub` após `unsubGraceMs`, para que
voltar de uma navegação não refaça tudo. Reconectou → reassina (ver 8.2).

## 7. Tipagem ponta a ponta

Um descriptor, três usos:

```ts
await api.users.list({ status: 'active' });      // HTTP puro, como hoje
useLive(api.users.list, { status: 'active' });   // subscrição
prefetch(api.users.list, { status: 'active' });  // SSR
```

`RouteSchema` (`packages/client/src/codegen/types.ts`) já carrega `method`,
`path`, `params`, `query`, `body`, `response`, `controllerName`, `handlerName`.
Ganha:

```ts
live?: { shared: 'private' | 'tenant' | 'public'; key?: string };
```

`dependsOn` **não** entra: é detalhe de invalidação do servidor e não deve vazar
pro bundle do cliente.

`resourceId` = `controllerName + handlerName`, já extraídos pelo scanner.

O scanner já tem `ScanWarning` com arquivo e linha; as regras de 5.6 passam a
aparecer em build, além do startup. Codegen pode estar desatualizado; o boot
não. Mesma regra, dois momentos.

**Hash de input é código compartilhado.** Cliente e servidor precisam produzir o
mesmo hash para os mesmos inputs, senão o dedupe silenciosamente para de
funcionar. Canonicalização de JSON (ordenação estável de chaves, normalização
numérica) e hash moram num módulo único importado pelos dois lados. Reusa FNV-1a,
já usado em `packages/orm/src/cache/cache-key-generator.ts`. Body de `POST` é
limitado a `maxInputBytes`, e a chave guarda o hash, nunca o payload.

## 8. Primeira carga, reconexão e degradação

### 8.1 Handshake por hash de conteúdo

O HTML da primeira carga já traz os dados embutidos (`instanceId`, `data`,
`hash`). O cliente inicializa a store com eles e, ao assinar, envia **o hash do
que está na tela**. O servidor computa, hasheia e responde `current` (nada no
fio) ou `snapshot`.

Hash e não revisão porque, com D4 e escala horizontal, o nó que atende o `sub`
pode nunca ter visto aquela instância: sem o snapshot da revisão N, não há como
produzir um patch de N para N+1. Comparar hashes não exige histórico e funciona
em qualquer nó. Revisão continua existindo, mas só para ordenar patches dentro
de uma sessão viva.

Efeito: primeira carga sem waterfall e sem payload duplicado.

### 8.2 Reconexão e deploy

Reassina enviando o hash. Igual → retoma sem tráfego. Diferente → snapshot. Não
há sessão para restaurar, porque não há sessão.

Deploy é reconexão em massa e cai no mesmo caminho, com uma ressalva
operacional: **backoff com jitter é obrigatório**. Sem ele, todos reconectam no
mesmo milissegundo e o recompute simultâneo derruba o banco. É o modo de falha
mais provável da feature em produção.

### 8.3 MVC e ilhas

Como um live resource é uma rota `GET`, uma página servida por
`@carno.js/views` pode ser renderizada inteira em Handlebars/EJS/Pug, e só as
ilhas que precisam de vida assinam. O `respond()` com content negotiation de
`packages/views/src/negotiate.ts` é o mecanismo: mesma rota, HTML pro navegador,
JSON pro adapter.

MVC com reatividade pontual e SPA React/Angular usam o mesmo backend sem
alteração no servidor.

### 8.4 Degradação

| Situação | Comportamento |
| :--- | :--- |
| WebSocket disponível | Live |
| WS bloqueado (proxy corporativo) | SSE pros patches, HTTP pras ações |
| Nem WS nem SSE | Polling por `GET` condicional, `ETag` = hash de conteúdo |
| Sem JS | HTML server-rendered correto, sem atualização |

O hash serve hidratação, reconexão e polling. Uma peça, três problemas.

## 9. Pacotes e fronteiras

Pacote novo `@carno.js/live`:

| Peça | Responsabilidade | Depende de |
| :--- | :--- | :--- |
| `DependencyGraph` | chaves ↔ instâncias | nada |
| `ResourceRegistry` | resources, validação de inputs, compute | core |
| `SubscriptionRegistry` | instâncias ↔ conexões | nada |
| `InvalidationBus` | interface + implementações | opcional por impl |
| `PatchEngine` | snapshot → snapshot = ops | nada |
| `LiveTransport` | fala o protocolo | `@carno.js/websocket` |
| `client/` | núcleo agnóstico + adapters | nada |
| `shared/` | canonicalização e hash de input | nada |

`DependencyGraph`, `SubscriptionRegistry`, `PatchEngine` e `shared/` são funções
puras sobre estruturas de dados — testáveis sem servidor, sem banco e sem
socket. É onde mora a lógica difícil, e é por isso que ela fica fora do
transporte. `ResourceRegistry` e `LiveTransport` são as únicas peças que tocam
I/O.

Alterações em pacotes existentes:

- `@carno.js/orm` — hook de coleta de dependência na leitura e de emissão na
  escrita, em `SqlBuilder.execute()` (`packages/orm/src/SqlBuilder.ts`), via
  `AsyncLocalStorage` no padrão de `identityMapContext` / `tenantContext` /
  `transactionContext`. Opcional: sem `@carno.js/live` instalado, nada muda.
- `@carno.js/client` — campo `live` em `RouteSchema`, emissão de descriptors,
  novos `ScanWarning`.
- `@carno.js/core` — nada obrigatório.

## 10. Modos de falha e guardas

| Falha | Guarda |
| :--- | :--- |
| Stampede de reconexão em deploy | Backoff com jitter |
| Recompute concorrente da mesma instância | Single-flight: N invalidações durante um recompute = um recompute a mais |
| Fan-out grande | Invalidação que acorda mais de `fanoutQueueThreshold` instâncias vai pra fila com prioridade, nunca stampede síncrono |
| Memória do grafo | `maxInstancesPerConnection`, `maxInstancesPerNode`, guarda de cardinalidade (4.3) |
| Cliente lento | Backpressure colapsa em snapshot |
| Vazamento entre usuários | Escopo privado por default (4.1) |
| Resource com SQL cru | Erro em dev, warn em prod (4.3) |

### 10.1 Parâmetros configuráveis

Todos ficam sob `live` na `carno.config.ts`. Os defaults abaixo são pontos de
partida a calibrar com a métrica de recompute-sem-patch, não valores medidos.

| Parâmetro | Default | Governa |
| :--- | :--- | :--- |
| `coalesceMs` | 16 | Janela de agrupamento de invalidações |
| `maxKeysPerRead` | 64 | Acima disso, dependência colapsa pro ancestral |
| `maxInputBytes` | 8192 | Teto do input de um `sub` (query ou body) |
| `unsubGraceMs` | 5000 | Carência antes de derrubar instância sem assinante |
| `maxPendingPatches` | 32 | Acima disso, colapsa em snapshot |
| `fanoutQueueThreshold` | 500 | Acima disso, recompute vai pra fila com prioridade |
| `maxInstancesPerConnection` | 64 | Teto por conexão |
| `maxInstancesPerNode` | 50000 | Teto por processo |
| `reconnectBackoff` | exponencial, jitter total, teto 30s | Reconexão do cliente |

Métricas via `ObservabilityService`: instâncias vivas, fan-out por invalidação,
recomputes por segundo, tamanho de patch e — a mais importante — **taxa de
recompute que não gerou patch**. Ela mede diretamente a precisão da
granularidade: se sobe, a invalidação está grossa demais e está queimando CPU e
banco à toa.

## 11. Riscos abertos

1. **Custo de recompute sob invalidação grossa.** Mitigado por filtro de coluna,
   chave por PK e "recompute ≠ patch", mas o número real só aparece em carga.
   A métrica da seção 10 é o instrumento.
2. **Triggers do `PgNotifyEmitter` como responsabilidade operacional.** Opt-in
   por tabela limita o problema, mas é superfície nova de migration.
3. **Cobertura do rastreamento automático.** Tudo que não passa pelo
   `SqlBuilder` (SQL cru, API externa, Redis, arquivo) exige `dependsOn` manual.
4. **MySQL fica com um degrau a menos**: só o emissor da aplicação.
5. **Compartilhamento estrutural correto** é pré-requisito do adapter React; se
   o `PatchEngine` errar identidade de objeto, o sintoma é loop de render.

## 12. Critérios de aceite

O design está entregue quando:

1. Um `UPDATE` via repository do ORM em um processo chega, sem código de
   broadcast, num `useLive` do React e num `liveSignal` do Angular.
2. Um `UPDATE` feito no `psql` chega às mesmas telas com o `PgNotifyEmitter`
   ligado naquela tabela.
3. Matar o nó que atendia a subscrição e deixar outro assumir não altera o que
   está na tela nem exige ação do usuário — e o `sub` de reconexão não
   retransmite dados que o cliente já tem.
4. Inserir um item no topo de uma lista com `key` declarada não perde o foco de
   um input aberto na mesma tela.
5. Uma escrita que só altera coluna não lida pelo resource não gera patch.
6. A mesma rota responde JSON correto para um `curl` sem WebSocket.
7. Uma página `@carno.js/views` renderiza server-side e só a ilha assinada
   atualiza.
8. Dois usuários de tenants diferentes assinando o mesmo resource com os mesmos
   inputs jamais veem o dado um do outro.

## 13. Fases

O design é grande demais para um único plano de implementação. Ele se divide em
três fases, cada uma com seu próprio plano, e cada uma entregando algo
demonstrável sozinha.

**Fase 1 — o núcleo prova a tese.** `DependencyGraph`, `SubscriptionRegistry`,
`PatchEngine`, `ResourceRegistry`, protocolo sobre `@carno.js/websocket`,
`InProcessBus`, `AppEmitter` no `SqlBuilder`, `@Live()` em `@Get()`, escopo,
adapter React, handshake por hash. Fecha os critérios 1, 3, 4, 5, 6 e 8.

**Fase 2 — alcance e tipos.** `PgNotifyEmitter`, bus distribuído,
`@Live()` em `@Post()`, campo `live` no codegen do `@carno.js/client`,
descriptors, `ScanWarning`, otimismo com `on`. Fecha o critério 2.

**Fase 3 — superfície.** Adapters Angular, Vue e vanilla; ilhas em
`@carno.js/views`; degradação SSE e polling; métricas no `ObservabilityService`.
Fecha o critério 7.

Fase 1 é a que decide se a ideia se sustenta. Se a métrica de
recompute-sem-patch já sair alta ali, o problema é a granularidade da seção 4.3,
e é melhor descobrir isso antes de construir as fases 2 e 3 em cima.
