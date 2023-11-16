import { Controller, Get } from '@cheetah.js/core';

@Controller()
export class DefaultRoutesCheetah {

  @Get('favicon.ico')
  async favicon() {
    return true;
  }
}