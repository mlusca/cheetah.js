---
sidebar_position: 2
---

# Performance Notes

Carno.js is designed first as an opinionated application framework for maintainable Bun services. Its HTTP core is still lightweight and competitive by design, and these benchmarks exist to keep that performance visible, reproducible, and protected over time.

---

## HTTP Benchmark Snapshot

The numbers below come from a small local HTTP benchmark under identical conditions. They are useful for regression tracking and rough comparison, but real application performance depends on routing complexity, middleware, validation, database access, infrastructure, and workload shape.

### Test Environment

| Parameter | Value |
|-----------|-------|
| **Tool** | [oha](https://github.com/hatoo/oha) (Ohayou HTTP load generator) |
| **Duration** | 6 seconds |
| **Endpoint** | `GET /` returning a simple string |
| **Runtime** | Bun |

---

## 📊 Results

<div className="benchmark-results">

| Framework | Requests/sec | Avg Latency | Fastest | Slowest |
|:----------|:------------:|:-----------:|:-------:|:-------:|
| 🥇 **Carno.js** | **234,562** | **0.21 ms** | 0.01 ms | 3.04 ms |
| 🥈 Elysia | 167,206 | 0.29 ms | 0.02 ms | 17.06 ms |

</div>

### Carno.js

```ansi
Summary:
  Success rate:   100.00%
  Total:          6000.93 ms
  Slowest:        3.0463 ms
  Fastest:        0.0131 ms
  Average:        0.2116 ms
  Requests/sec:   234,562.81

Response time distribution:
  10.00% in 0.1548 ms
  25.00% in 0.1618 ms
  50.00% in 0.1722 ms   ← median
  75.00% in 0.2701 ms
  90.00% in 0.2940 ms
  95.00% in 0.3230 ms
  99.00% in 0.5540 ms
  99.90% in 1.3634 ms
  99.99% in 1.9256 ms
```

### 🔵 Elysia

```ansi
Summary:
  Success rate:   100.00%
  Total:          6000.99 ms
  Slowest:        17.0686 ms
  Fastest:        0.0238 ms
  Average:        0.2974 ms
  Requests/sec:   167,206.54

Response time distribution:
  10.00% in 0.2063 ms
  25.00% in 0.2152 ms
  50.00% in 0.2311 ms   ← median
```

---

## Run Your Own Benchmark

You can run the same style of benchmark locally to compare results in your own environment.

### Prerequisites

Make sure you have [oha](https://github.com/hatoo/oha) installed:

```bash
# macOS
brew install oha

# Cargo
cargo install oha
```

### Run the test

Create a simple Carno.js server and benchmark it:

```typescript
// server.ts
import { Carno, Controller, Get } from '@carno.js/core';

@Controller()
class BenchmarkController {
  @Get('/')
  health() {
    return 'ok';
  }
}

const app = new Carno({ providers: [BenchmarkController] });
app.listen(3000);
```

```bash
# Start the server (in one terminal)
bun server.ts

# Run the benchmark (in another terminal)
oha -z 6s http://localhost:3000/
```

:::tip Keep benchmarks contextual
When comparing frameworks, include the runtime version, hardware, route shape, middleware stack, and benchmark command so results are easier to reproduce.
:::

---

## ORM Bulk Operations

Carno ORM ships first-class batch APIs that collapse N round-trips into ⌈N/chunkSize⌉ statements. Measured on Bun 1.3, 500 rows, single connection:

| Operation                          | Postgres | MySQL  |
|------------------------------------|----------|--------|
| `bulkCreate` vs `create()` loop    | **~48×** | **~114×** |
| `bulkUpdate` vs `updateById()`     | **~71×** | **~182×** |
| `bulkDelete` vs `deleteById()`     | **~53×** | **~94×**  |
| `Session.flush()` (mixed graph)    | **~57×** | **~106×** |

See the [Bulk Operations](./orm/bulk-operations) and [Session](./orm/session) docs for usage and trade-offs.
