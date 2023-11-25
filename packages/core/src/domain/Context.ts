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

  private constructor() {}

  static async createFromRequest(url: any, request: Request, server: Serve) {
    const context = new Context();
    if (request.method === 'GET') {
      context.setQuery(url);
    } else {
      if (request.headers.get('content-type').includes('application/json')) {
        context.body = await request.json();
      } else if (request.headers.get('content-type').includes('application/x-www-form-urlencoded')) {
        context.setBody(await request.formData());
      } else if (request.headers.get('content-type').includes('multipart/form-data')) {
        context.setBody(await request.formData());
      } else {
        context.body = { body: await request.text() };
      }
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

  private setBody(body: any) {
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
}