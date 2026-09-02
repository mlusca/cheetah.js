import type { Statement } from '../driver/driver.interface';
import { transactionContext } from '../transaction/transaction-context';

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
  private pendingWrites = new Map<unknown, Statement<any>[]>();

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
    this.pendingWrites.clear();
  }

  notifyRead(statement: Statement<any>): void {
    if (this.readListener) {
      this.readListener(statement);
    }
  }

  notifyWrite(statement: Statement<any>): void {
    if (!this.writeListener) {
      return;
    }

    const transaction = transactionContext.getContext();

    if (transaction) {
      const pending = this.pendingWrites.get(transaction) || [];
      pending.push(statement);
      this.pendingWrites.set(transaction, pending);
      return;
    }

    this.writeListener(statement);
  }

  /** Flushes writes after the database transaction has committed. */
  commitTransaction(transaction: unknown): void {
    const pending = this.pendingWrites.get(transaction);
    this.pendingWrites.delete(transaction);

    if (!pending || !this.writeListener) {
      return;
    }

    for (const statement of pending) {
      this.writeListener(statement);
    }
  }

  /** Discards writes from a transaction that rolled back or failed to commit. */
  rollbackTransaction(transaction: unknown): void {
    this.pendingWrites.delete(transaction);
  }

  notifyWriteAttempt(statement: Statement<any>): void {
    if (this.writeAttemptListener) {
      this.writeAttemptListener(statement);
    }
  }
}

export const statementObserver = new StatementObserver();
