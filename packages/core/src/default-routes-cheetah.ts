import { Controller } from "./commons/decorators/controller.decorator";
import { Get } from "./commons/decorators/http.decorators";

@Controller()
export class DefaultRoutesCheetah {
  @Get("favicon.ico")
  async favicon() {
    return true;
  }
}
