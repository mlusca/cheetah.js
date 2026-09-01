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
