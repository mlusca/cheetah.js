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
