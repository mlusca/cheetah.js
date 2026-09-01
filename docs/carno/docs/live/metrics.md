---
sidebar_position: 7
---

# Metrics and precision

The live engine emits metrics through the structural `onMetric(name, value,
tags)` sink. Install the application's observability integration as usual; the
live package does not require a particular metrics vendor, and a missing or
failing sink never breaks invalidation or recomputation.

## Published names

| Name | Value | Tags | Meaning |
| --- | --- | --- | --- |
| `live.recompute` | `1` | `resource`, `patched` | One instance recomputed; `patched` says whether the result produced a patch |
| `live.recompute.ms` | Duration in milliseconds | `resource` | Time spent computing the resource and producing its diff |
| `live.patch.ops` | Number of operations | `resource` | Size of a patch, emitted when a patch was produced |
| `live.invalidation.keys` | Number of invalidation keys | None | Keys emitted by one invalidation batch |
| `live.invalidation.fanout` | Number of affected instances | None | Instances selected by the dependency graph |
| `live.instances` | Current count | None | Live instances currently held by the process |

Tags are deliberately small and stable. Use `resource` to find a noisy or
slow handler, and use `patched` to distinguish useful work from a recompute
whose output was equal to the previous output.

## `patched=false` is a precision signal

`live.recompute` with `patched=false` is the direct measure of invalidation
granularity. The engine woke an instance, reran its handler, and discovered
that the value did not change. A rising rate means broad invalidation is
burning CPU and database time without producing client-visible work.

For example, a resource that reads one tenant's tasks should not recompute for
every task in every tenant. First check whether the ORM could record the exact
row or column dependencies. Then narrow the declaration:

```ts
@Live({
  key: 'id',
  dependsOn: ['app:tenant:acme:tasks']
})
listForTenant() {
  return this.tasks.forTenant('acme');
}
```

For ORM reads, a more specific `@Live({ key })` improves patch precision for
collections, while an explicit `dependsOn` key is the remedy for data sources
the ORM cannot observe. Keep the manual key as narrow as the source's actual
change boundary. Do not solve a high `patched=false` rate by merely increasing
`coalesceMs`: coalescing reduces bursts, but it does not make the dependency
graph more precise.

## Reading the other signals

- Compare `live.invalidation.fanout` with `live.recompute` to see how much of a
  write's fan-out actually ran.
- Track `live.recompute.ms` by resource to find database-heavy handlers before
  changing process limits.
- Track `live.patch.ops` alongside response and socket metrics. A large patch
  count can indicate an unstable ordering key or a collection that should be
  split into smaller resources.
- Use `live.instances` with the configured per-connection and per-node limits
  to detect a subscription leak or an input space that is too broad.

The metrics describe server work, not authorization. Resource sharing and
scope boundaries remain enforced by the live authorizer and scope resolver.
