import { Cheetah, InjectorService } from "@cheetah.js/core";
import { beforeAll, describe, expect, test } from "bun:test";
import { SwaggerModule } from "@cheetah.js/swagger";

describe("Swagger", () => {
  let injector: InjectorService;

  beforeAll(() => {
    const app = new Cheetah();
    app.use(SwaggerModule({}))
    app.init();
    injector = app.getInjector();
  });

  test("should useValue", () => {});
});
