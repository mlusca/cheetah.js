import { Cheetah, registerController } from "@cheetah.js/core";
import { CheetahSwaggerConfig, SwaggerService, useConfig } from "./swagger.service";

export const SwaggerModule = (config: CheetahSwaggerConfig) => {
  const app = new Cheetah({
    exports: [SwaggerService],
    providers: [SwaggerService],
  });
  useConfig(config);
  return app;
};
