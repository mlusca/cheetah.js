import { describe, expect, it } from "bun:test";
import { Carno, Service, PostConstruct, PreDestroy, Container } from "../src";
import { PRE_DESTROY_META } from "../src/metadata";

describe("PostConstruct and PreDestroy Lifecycle Hooks", () => {
  it("executes @PostConstruct right after service instantiation/DI", () => {
    const events: string[] = [];

    @Service()
    class DependencyService {
      constructor() {
        events.push("dependency-init");
      }

      @PostConstruct()
      afterInit() {
        events.push("dependency-post-construct");
      }
    }

    @Service()
    class MainService {
      constructor(public dep: DependencyService) {
        events.push("main-init");
      }

      @PostConstruct()
      afterInit() {
        events.push("main-post-construct");
      }
    }

    const app = new Carno({ disableStartupLog: true });
    app.services([DependencyService, MainService]);
    
    // Trigger bootstrap to instantiate everything
    app.listen(3015);
    app.stop();

    // Verification:
    // 1. DependencyService constructor
    // 2. DependencyService PostConstruct
    // 3. MainService constructor
    // 4. MainService PostConstruct
    expect(events).toEqual([
      "dependency-init",
      "dependency-post-construct",
      "main-init",
      "main-post-construct"
    ]);
  });

  it("handles promise/async returning @PostConstruct cleanly", async () => {
    let postConstructDone = false;
    let promiseResolved = false;

    @Service()
    class AsyncPostConstructService {
      @PostConstruct()
      async init(): Promise<void> {
        postConstructDone = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        promiseResolved = true;
      }
    }

    const app = new Carno({ disableStartupLog: true });
    app.services([AsyncPostConstructService]);
    app.listen(3016);
    
    expect(postConstructDone).toBe(true);
    // Since get() is synchronous, it does not await the promise, so promiseResolved is still false initially
    expect(promiseResolved).toBe(false);

    // Let the promise finish
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(promiseResolved).toBe(true);

    app.stop();
  });

  it("executes @PreDestroy during application shutdown / container destroy", async () => {
    const events: string[] = [];

    @Service()
    class DestroyService {
      @PreDestroy()
      cleanup() {
        events.push("destroy");
      }
    }

    const container = new Container();
    container.register(DestroyService);
    
    // Resolve service to instantiate it
    container.get(DestroyService);

    expect(events).toEqual([]);

    await container.destroy();

    expect(events).toEqual(["destroy"]);
  });

  it("awaits asynchronous @PreDestroy hooks", async () => {
    const events: string[] = [];

    @Service()
    class AsyncDestroyService {
      @PreDestroy()
      async cleanup() {
        events.push("start-cleanup");
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("end-cleanup");
      }
    }

    const container = new Container();
    container.register(AsyncDestroyService);
    container.get(AsyncDestroyService);

    expect(events).toEqual([]);

    await container.destroy();

    expect(events).toEqual(["start-cleanup", "end-cleanup"]);
  });

  it("handles errors thrown inside @PostConstruct and @PreDestroy hooks safely", async () => {
    let errorCaught = false;

    @Service()
    class ErrorHookService {
      @PostConstruct()
      postConstructHook() {
        throw new Error("PostConstruct error");
      }

      @PreDestroy()
      preDestroyHook() {
        throw new Error("PreDestroy error");
      }
    }

    // Mock console.error to check if it logs but does not crash
    const originalError = console.error;
    console.error = () => {
      errorCaught = true;
    };

    try {
      const container = new Container();
      container.register(ErrorHookService);
      
      // Should not throw on instantiation
      const instance = container.get(ErrorHookService);
      expect(instance).toBeDefined();
      expect(errorCaught).toBe(true);

      errorCaught = false;
      // Should not throw on destroy
      await container.destroy();
      expect(errorCaught).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  it("executes @PreDestroy hooks in reverse order of instantiation (dependencies last)", async () => {
    const destructions: string[] = [];

    @Service()
    class BottomService {
      @PreDestroy()
      cleanup() {
        destructions.push("bottom");
      }
    }

    @Service()
    class TopService {
      constructor(public bottom: BottomService) {}

      @PreDestroy()
      cleanup() {
        destructions.push("top");
      }
    }

    const container = new Container();
    container.register(BottomService);
    container.register(TopService);

    container.get(TopService);

    await container.destroy();

    expect(destructions).toEqual(["top", "bottom"]);
  });

  it("registers shutdown handling when only @PreDestroy hooks exist", async () => {
    const events: string[] = [];
    const handlers = new Map<string, (...args: any[]) => any>();

    @Service()
    class DestroyOnlyService {
      @PreDestroy()
      cleanup() {
        events.push("destroy");
      }
    }

    const originalOn = process.on;
    const originalExit = process.exit;

    process.on = ((event: string, listener: (...args: any[]) => any) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.on;

    process.exit = ((code?: number) => {
      events.push(`exit-${code}`);
      return undefined as never;
    }) as typeof process.exit;

    try {
      const app = new Carno({ disableStartupLog: true });
      app.services([DestroyOnlyService]);
      app.listen(3017);

      const sigterm = handlers.get("SIGTERM");
      expect(sigterm).toBeDefined();

      await sigterm?.();

      expect(events).toEqual(["destroy", "exit-0"]);
    } finally {
      process.on = originalOn;
      process.exit = originalExit;
    }
  });

  it("executes @PreDestroy hooks from useClass providers", async () => {
    const events: string[] = [];

    class PaymentGateway {}

    @Service()
    class StripeGateway extends PaymentGateway {
      @PreDestroy()
      cleanup() {
        events.push("stripe-destroy");
      }
    }

    const container = new Container();
    container.register({ token: PaymentGateway, useClass: StripeGateway });

    container.get(PaymentGateway);

    await container.destroy();

    expect(events).toEqual(["stripe-destroy"]);
  });

  it("handles PreDestroy metadata registered after construction", async () => {
    const events: string[] = [];
    const handlers = new Map<string, (...args: any[]) => any>();

    @Service()
    class Stage3LikeDestroyService {
      constructor() {
        Reflect.defineMetadata(PRE_DESTROY_META, "cleanup", this.constructor);
      }

      cleanup() {
        events.push("destroy");
      }
    }

    const originalOn = process.on;
    const originalExit = process.exit;

    process.on = ((event: string, listener: (...args: any[]) => any) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.on;

    process.exit = ((code?: number) => {
      events.push(`exit-${code}`);
      return undefined as never;
    }) as typeof process.exit;

    try {
      const app = new Carno({ disableStartupLog: true });
      app.services([Stage3LikeDestroyService]);
      app.listen(3018);

      const sigterm = handlers.get("SIGTERM");
      expect(sigterm).toBeDefined();

      await sigterm?.();

      expect(events).toEqual(["destroy", "exit-0"]);
    } finally {
      process.on = originalOn;
      process.exit = originalExit;
    }
  });
});
