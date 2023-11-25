import { Serve } from 'bun';
import { Injectable, ProviderScope } from '@cheetah.js/core';

@Injectable({ scope: ProviderScope.REQUEST })
export class Context {

  query: Record<string, any> = {}
  body: Record<string, any> = {}
  param: Record<string, any> = {}
  req: Record<string, any> = {};
  headers: Record<string, any> = {};
  locals: Record<string, any> = {};

  private resultStatus: number = 200;
  private constructor() {}

  static async createFromRequest(url: any, request: Request, server: Serve) {
    const context = new Context();
    if (request.method === 'GET') {
      context.setQuery(url);
    } else {
      // @ts-ignore
      context.setBody(await request.formData());
    }

    context.setReq(request);
    // @ts-ignore
    context.setHeaders(request.headers);
    return context;
  }

  // @ts-ignore
  private setQuery({query}) {
    this.query = new URLSearchParams(query)
  }

  private setBody(body: FormData) {
    for (const [key, value] of body.entries()) {
      this.body[key] = value;
    }
  }

  private setReq(req: Record<string, any>) {
    this.req = req;
  }

  private setHeaders(headers: Headers) {
    for (const [key, value] of headers.entries()) {
      this.headers[key] = value;
    }
  }

  setParam(param: Record<string, any>) {
    this.param = param;
  }

  setResponseStatus(status: number) {
    this.resultStatus = status;
  }

  getResponseStatus() {
    return this.resultStatus;
  }
}