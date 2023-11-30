import { Cheetah, InjectorService } from "@cheetah.js/core";
import { beforeAll, describe, expect, test } from "bun:test";
import { SwaggerModule } from "@cheetah.js/swagger";

describe("Swagger", () => {
  let injector: InjectorService;

  beforeAll(() => {
    const app = new Cheetah();
    app.use(SwaggerModule({ path: "/swagger" }));
    try {
      app.init();
    } catch (e) {
      console.log(e);
    }
    injector = app.getInjector();
  });

  test("should useValue", () => {});
});
