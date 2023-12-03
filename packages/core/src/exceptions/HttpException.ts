import { isObject } from "../utils";


export class HttpException {
  public message: string | object;

  constructor(public response: any, public statusCode: any) {
    this.initMessage()
  }

  public initMessage() {
    if (isObject(this.response)) {
      this.message = this.response as any
    } else {
      this.message = this.response
    }
  }

  public getResponse(): string | object {
    return this.message;
  }

  public getStatus(): number {
    return this.statusCode;
  }
}