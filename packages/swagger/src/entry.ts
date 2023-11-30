import { Cheetah, registerController } from "@cheetah.js/core";
import { CheetahSwaggerConfig, SwaggerService } from "./swagger.service";

export const SwaggerModule = (config: CheetahSwaggerConfig) => {
  registerController({ provide: SwaggerService }, new SwaggerService(config));
  const app = new Cheetah({
    exports: [SwaggerService],
    providers: [SwaggerService],
  });
  return app;
};
