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
