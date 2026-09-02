---
sidebar_position: 2
---

# Scaling live resources

The invalidation you get by default covers one axis: writes made through
`@carno.js/orm`, inside one process. That is the common case and it costs no
infrastructure at all. This page covers the other two axes — writes made by
someone who is not your application, and applications that run on more than one
process — and both are opt-in. Turn neither on and nothing on this page runs.

## Writes the ORM never saw

A migration, a `psql` session, a scheduled job in another language, a support
engineer fixing a row by hand: none of them go through your ORM, so the
in-process emitter has nothing to observe. The screen keeps showing what it had
and nobody is told otherwise, which is the worst failure mode a live system has.

A Postgres trigger sees them all, because it runs inside the transaction that
wrote the row. The `pgNotify` option installs one per table you name:

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

The trigger reports the table, the primary key of the row, and the columns that
changed — the same three things the ORM emitter reports. The dependency graph
cannot tell the two apart, and does not need to: a resource that declared
`orm:cards#42` is woken by whichever emitter saw the write.

This requires **PostgreSQL 11 or newer**, for `CREATE TRIGGER ... EXECUTE
FUNCTION`. It is Postgres-only; a MySQL application never touches this code
path. The connection string defaults to the ORM's own, and `url` overrides it.

### What gets installed

Two things, both at boot and both idempotent:

- one `carno_live_notify()` function, shared by every watched table;
- one `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` trigger per table,
  named `carno_live_<table>`.

Installing them means the application runs DDL at startup, so the database user
needs the privilege, and other systems reading your schema will see the
triggers. That is a large enough consequence to be worth opting into
deliberately, which is why there is no default list.

Each notification is a small JSON payload on the channel (`carno_live` unless
you set `channel`):

```json
{ "t": "cards", "i": "42", "c": ["title", "done"] }
```

`t` is the table, `i` the primary key, `c` the changed columns. A `null` in
`i` means "somewhere in this table"; a `null` in `c` means "we do not know
which columns", and both degrade the same way — coarser, never absent.

### What it costs

One trigger execution per row written, one `jsonb` diff per `UPDATE`, and one
notification per row that actually changed. Three consequences follow:

- **An `UPDATE` that writes the same value sends nothing.** The diff is empty
  and the trigger returns without notifying. This is the "recompute is not a
  patch" rule, one level down.
- **A statement that touches many rows sends many notifications.** An
  `UPDATE cards SET done = true WHERE tenant_id = 7` over a hundred thousand
  rows fires a hundred thousand times. The coalescing window absorbs the cost on
  the application side; the database pays for it regardless. Keep tables written
  in bulk out of `pgNotify`.
- **An oversized payload degrades to the whole table.** Above roughly 7000
  bytes the trigger sends `{"t": "cards", "i": null, "c": null}` instead, which
  invalidates every subscriber of that table. Truncating the payload would
  produce something that parses as a *different* row, which is worse than
  imprecise.

### The gap after a reconnect

A `LISTEN` connection is a socket, and sockets drop. Everything published while
it was down arrived nowhere, and Postgres has no way to tell you what you
missed. There is no partial recovery available here.

So on reconnect the emitter invalidates **every watched table, in full**. That
is a recompute storm, and it is the right trade: the alternative is a screen
frozen on stale data with no error anywhere to explain it. Coarse invalidation
costs CPU; a missed one costs correctness.

## More than one process

The in-process emitter and `LiveService.invalidate()` are, by construction,
local: they observe what *this* process did. Two nodes behind a load balancer
means a write handled by node A leaves node B's subscribers untouched.

```ts
LivePlugin.create({
    controllers: [CardsController],
    distributed: { transport: 'pg-notify' },
});
```

With this on, every invalidation raised locally is also published on a second
channel (`carno_live_bus`) that the other nodes are listening to. Without it,
the bus stays in-process and behaves exactly as before.

### Node identity and echo

Each process takes a node id — pass `nodeId` or let it generate one. Postgres
delivers a notification to every listening session including the one that sent
it, so without the id every invalidation would be delivered twice on the
publishing node: once locally, once by its own echo. The id is what makes the
echo recognisable and droppable.

Large batches are split into frames under the payload ceiling, and a single
event too large to fit on its own degrades to its table key.

### Combining both

They compose, and need no extra configuration to do so. When a table is watched
by `pgNotify`, the ORM emitter stops announcing it: the trigger already reached
every node at once, so publishing it on the bus would send the same write around
the cluster a second time. Tables not in the list keep going through the bus as
usual.

## Choosing

| Your situation | What to turn on |
| :--- | :--- |
| One process, every write goes through the ORM | Nothing. This is the default. |
| One process, writes also come from outside | `pgNotify` |
| Several processes, every write goes through the ORM | `distributed` |
| Several processes, writes also come from outside | Both |

The two options are independent switches, and both default to off. Turning them
off again restores the previous behaviour exactly — including which emitter
announces which table.
