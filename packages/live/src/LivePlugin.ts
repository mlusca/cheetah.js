import { Carno, ObservabilityService, type Container } from '@carno.js/core';
import { Orm } from '@carno.js/orm';
import { WebSocketPlugin, type WebSocketPluginConfig } from '@carno.js/websocket';
import { AllowAllAuthorizer, type LiveAuthorizer } from './auth/authorizer';
import { InProcessBus } from './bus/InProcessBus';
import type { InvalidationBus } from './bus/InvalidationBus';
import { PgNotifyBus } from './bus/PgNotifyBus';
import { PgNotifyEmitter, type PgNotifyTable } from './emitters/pg-notify-emitter';
import type { InvalidationEvent } from './graph/types';
import { resolveLiveConfig, type LiveConfig } from './config';
import { AppEmitter } from './emitters/AppEmitter';
import { DependencyGraph } from './graph/DependencyGraph';
import { SubscriptionRegistry } from './graph/SubscriptionRegistry';
import { LiveEngine } from './LiveEngine';
import { LiveMetrics } from './observability';
import { LiveService } from './LiveService';
import { ResourceRegistry } from './resource/ResourceRegistry';
import { setLiveRuntime } from './runtime';
import { LiveETagMiddleware } from './http/etag';
import { FanTransport } from './transport/FanTransport';
import { dropLiveConnection, LiveGateway } from './transport/LiveGateway';
import { ConnectionScopeResolver, type LiveScopeResolver } from './transport/scope-resolver';
import { SocketTransport } from './transport/SocketTransport';
import { SseTransport } from './transport/SseTransport';
import { createSseRoutes } from './transport/sse-routes';

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
    /**
     * Decides whether a connection may hold a subscription, and is re-asked
     * whenever `LiveService.invalidate('auth:principal#<id>')` fires.
     */
    authorizer?: LiveAuthorizer;
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
    config?: Partial<LiveConfig>;
    websocket?: WebSocketPluginConfig;
    /**
     * Content-hash ETag on live GET routes, so a client with neither
     * WebSocket nor SSE can poll cheaply. On by default: it only ever adds a
     * header, and it only touches routes that are live.
     */
    etag?: boolean;
    /**
     * Serve the protocol over Server-Sent Events as well, for clients whose
     * proxy blocks WebSocket. Off by default: it adds two public routes.
     */
    sse?: boolean;
}

export class LivePlugin {
    static create(options: LivePluginOptions): Carno {
        const config = resolveLiveConfig(options.config);
        const resources = new ResourceRegistry();
        const graph = new DependencyGraph();
        const subs = new SubscriptionRegistry();
        const distributedBus = options.distributed
            ? new PgNotifyBus({
                url: options.distributed.url ?? '',
                channel: options.distributed.channel,
                nodeId: options.distributed.nodeId
            })
            : null;
        const bus: InvalidationBus = distributedBus ?? new InProcessBus();
        const sockets = new SocketTransport();
        const fan = new FanTransport();
        fan.add(sockets);
        let sink: ObservabilityService | null = null;
        const metrics = new LiveMetrics({
            onMetric: (name, value, tags) => sink?.onMetric(name, value, tags)
        });

        const engine = new LiveEngine(
            resources,
            graph,
            subs,
            bus,
            fan,
            config,
            options.authorizer ?? new AllowAllAuthorizer(),
            metrics
        );
        const emitter = new AppEmitter(bus, config);

        const dispose: (() => Promise<void> | void)[] = [() => engine.stop()];

        setLiveRuntime({
            engine,
            transport: sockets,
            resolver: options.scopeResolver ?? new ConnectionScopeResolver(),
            scopes: new Map(),
            resources,
            dispose
        });

        const plugin = new Carno({ exports: [] });
        plugin.services([LiveService]);

        if (options.sse) {
            const sse = new SseTransport({
                heartbeatMs: config.sseHeartbeatMs,
                maxConnections: config.sseMaxConnections,
                onDisconnect: dropLiveConnection
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

        let teachEtag: ((paths: { method: string; path: string }[]) => void) | null = null;

        if (options.etag !== false) {
            // Registered now, taught later: `plugin.middlewares()` runs before
            // bootstrap, and the resources are only known inside the builder.
            const etag = new LiveETagMiddleware([]);
            plugin.middlewares([etag]);
            teachEtag = paths => etag.setPaths(paths);
        }

        const websocket = WebSocketPlugin.create(
            [LiveGateway, ...(options.gateways ?? [])],
            options.websocket
        );

        const innerBuilder = websocket._wsHandlerBuilder!;
        const upgradePaths = [...websocket._wsUpgradePaths];

        plugin.use(websocket);

        // The builder runs after bootstrap, when the container holds the
        // controller instances and the ORM holds its connection — which is why
        // everything that needs a database URL is started here and not above.
        plugin.wsHandler((container: Container) => {
            // Resolved here and not above: the container does not exist until
            // bootstrap, and an app with no observability plugin never
            // registers one.
            sink = container.has(ObservabilityService) ? container.get(ObservabilityService) : null;

            for (const ControllerClass of options.controllers) {
                resources.register(ControllerClass, container.get(ControllerClass));
            }

            teachEtag?.(resources.livePaths());

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
                dispose.push(() => pgEmitter.detach());

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

                dispose.push(() => distributedBus.stop());
            }

            emitter.attach();
            engine.start();

            return innerBuilder(container);
        }, upgradePaths);

        return plugin;
    }
}
