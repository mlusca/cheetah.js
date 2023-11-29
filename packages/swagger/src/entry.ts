import { Cheetah, registerProvider } from "@cheetah.js/core";
import { CheetahSwaggerConfig, SwaggerService } from "./swagger.service";

export const SwaggerModule = (config: CheetahSwaggerConfig) => {
  const app = new Cheetah({
    exports: [SwaggerService],
    providers: [SwaggerService],
  });
  registerProvider({ provide: SwaggerService, useValue: () => new SwaggerService(config) });
  return app;
};
