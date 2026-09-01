import { statementObserver, type Statement } from '@carno.js/orm';
import type { InvalidationBus } from '../bus/InvalidationBus';
import type { LiveConfig } from '../config';
import { tableOfKey } from '../graph/dep-key';
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
    /** Tables announced by another emitter, so we do not announce them twice. */
    private covered = new Set<string>();

    constructor(
        private readonly bus: InvalidationBus,
        private readonly config: LiveConfig
    ) {}

    setCoveredTables(tables: Iterable<string>): void {
        this.covered = new Set(tables);
    }

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
            const events = writeEvents(statement, this.config.maxKeysPerRead);
            // A table watched by the Postgres emitter already announces itself
            // through the trigger, on every node at once. Publishing here too
            // would only buy a duplicate recompute.
            const ours = events.filter(event => !this.covered.has(tableOfKey(event.key) ?? ''));

            this.bus.publish(ours);
        });
    }

    detach(): void {
        statementObserver.reset();
    }
}
