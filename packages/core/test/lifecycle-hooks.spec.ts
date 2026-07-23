import { afterEach, describe, expect, it } from "bun:test";
import { Carno, Service, OnApplicationInit, OnApplicationBoot, Controller, Get } from "../src";
import { clearEventRegistry } from "../src/events/Lifecycle";

describe("Lifecycle hooks", () => {
  let app: Carno | null = null;

  afterEach(() => {
    app?.stop();
    app = null;
    clearEventRegistry();
  });

  it("executes OnApplicationInit hooks when app.listen() is called", async () => {
    const executionOrder: string[] = [];

    @Service()
    class InitHookService {
      @OnApplicationInit()
      onAppInit(): void {
        executionOrder.push("hook");
      }
    }

    executionOrder.push("before-listen");

    app = new Carno({ disableStartupLog: true });
    app.services(InitHookService);
    await app.listen(3010);

    executionOrder.push("after-listen");

    expect(executionOrder).toEqual(["before-listen", "hook", "after-listen"]);
  });

  it("executes OnApplicationBoot hooks after server is ready", async () => {
    const executionOrder: string[] = [];

    @Service()
    class BootHookService {
      @OnApplicationBoot()
      onAppBoot(): void {
        executionOrder.push("boot");
      }
    }

    executionOrder.push("before-listen");

    app = new Carno({ disableStartupLog: true });
    app.services(BootHookService);
    await app.listen(3011);

    executionOrder.push("after-listen");

    expect(executionOrder).toEqual(["before-listen", "boot", "after-listen"]);
  });

  it("executes hooks in priority order", async () => {
    const executionOrder: string[] = [];

    @Service()
    class PriorityService {
      @OnApplicationInit(10)
      highPriority(): void {
        executionOrder.push("high");
      }

      @OnApplicationInit(1)
      lowPriority(): void {
        executionOrder.push("low");
      }
    }

    app = new Carno({ disableStartupLog: true });
    app.services(PriorityService);
    await app.listen(3012);

    expect(executionOrder).toEqual(["high", "low"]);
  });

  it("awaits async OnApplicationInit hooks before listen resolves", async () => {
    const executionOrder: string[] = [];

    @Service()
    class AsyncPriorityService {
      @OnApplicationInit(10)
      async highPriority(): Promise<void> {
        executionOrder.push("high-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionOrder.push("high-end");
      }

      @OnApplicationInit(1)
      lowPriority(): void {
        executionOrder.push("low");
      }
    }

    app = new Carno({ disableStartupLog: true });
    app.services(AsyncPriorityService);
    await app.listen(3013);

    executionOrder.push("after-listen");

    // Higher priority async work must finish before lower priority and before listen returns
    expect(executionOrder).toEqual(["high-start", "high-end", "low", "after-listen"]);
  });

  it("does not accept traffic until async OnApplicationInit completes", async () => {
    let initDone = false;
    let sawRequestDuringInit = false;

    @Service()
    class WarmupService {
      @OnApplicationInit()
      async warm(): Promise<void> {
        // Overlap a request attempt with init; server must not be up yet
        await Promise.all([
          new Promise<void>((resolve) => setTimeout(resolve, 40)),
          fetch("http://127.0.0.1:3014/ready")
            .then(() => {
              sawRequestDuringInit = true;
            })
            .catch(() => {
              // Expected: connection refused while init is still running
            }),
        ]);
        initDone = true;
      }
    }

    @Controller()
    class ReadyController {
      @Get("/ready")
      ready() {
        return { ok: true, initDone };
      }
    }

    app = new Carno({ disableStartupLog: true });
    app.services(WarmupService);
    app.controllers(ReadyController);
    await app.listen(3014);

    expect(initDone).toBe(true);
    expect(sawRequestDuringInit).toBe(false);

    const res = await fetch("http://127.0.0.1:3014/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, initDone: true });
  });

  it("propagates OnApplicationInit failures and does not start the server", async () => {
    @Service()
    class FailingInitService {
      @OnApplicationInit()
      async fail(): Promise<void> {
        throw new Error("init failed");
      }
    }

    app = new Carno({ disableStartupLog: true });
    app.services(FailingInitService);

    await expect(app.listen(3019)).rejects.toThrow("init failed");
    expect((app as any).server).toBeUndefined();
  });

  it("does not await async OnApplicationBoot hooks before listen resolves", async () => {
    const executionOrder: string[] = [];

    @Service()
    class AsyncBootService {
      @OnApplicationBoot()
      async onBoot(): Promise<void> {
        executionOrder.push("boot-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionOrder.push("boot-end");
      }
    }

    app = new Carno({ disableStartupLog: true });
    app.services(AsyncBootService);
    await app.listen(3020);

    executionOrder.push("after-listen");

    expect(executionOrder).toEqual(["boot-start", "after-listen"]);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(executionOrder).toEqual(["boot-start", "after-listen", "boot-end"]);
  });
});
