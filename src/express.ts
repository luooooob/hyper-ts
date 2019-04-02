import { Request, Response, RequestHandler } from 'express'
import { Task } from 'fp-ts/lib/Task'
import { right } from 'fp-ts/lib/TaskEither'
import { IncomingMessage } from 'http'
import { Connection, CookieOptions, Middleware, Status } from '.'

type Action =
  | { type: 'setBody'; body: unknown }
  | { type: 'endResponse' }
  | { type: 'setStatus'; status: Status }
  | { type: 'setHeader'; name: string; value: string }
  | { type: 'clearCookie'; name: string; options: CookieOptions }
  | { type: 'setCookie'; name: string; value: string; options: CookieOptions }

const endResponse: Action = { type: 'endResponse' }

export class ExpressConnection<S> implements Connection<S> {
  readonly _S!: S
  constructor(readonly req: Request, readonly res: Response, readonly actions: Array<Action>) {}
  chain<T>(action: Action): ExpressConnection<T> {
    return new ExpressConnection<T>(this.req, this.res, [...this.actions, action])
  }
  getRequest(): IncomingMessage {
    return this.req
  }
  getBody(): unknown {
    return this.req.body
  }
  getHeader(name: string): unknown {
    return this.req.header(name)
  }
  getParams(): unknown {
    return this.req.params
  }
  getQuery(): unknown {
    return this.req.query
  }
  getOriginalUrl(): string {
    return this.req.originalUrl
  }
  getMethod(): string {
    return this.req.method
  }
  setCookie<T>(name: string, value: string, options: CookieOptions): Connection<T> {
    return this.chain({ type: 'setCookie', name, value, options })
  }
  clearCookie<T>(name: string, options: CookieOptions): Connection<T> {
    return this.chain({ type: 'clearCookie', name, options })
  }
  setHeader<T>(name: string, value: string): Connection<T> {
    return this.chain({ type: 'setHeader', name, value })
  }
  setStatus<T>(status: Status): Connection<T> {
    return this.chain({ type: 'setStatus', status })
  }
  setBody<T>(body: unknown): Connection<T> {
    return this.chain({ type: 'setBody', body })
  }
  endResponse<T>(): Connection<T> {
    return this.chain(endResponse)
  }
}

const run = (res: Response, action: Action): Response => {
  switch (action.type) {
    case 'clearCookie':
      return res.clearCookie(action.name, action.options)
    case 'endResponse':
      res.end()
      return res
    case 'setBody':
      return res.send(action.body)
    case 'setCookie':
      return res.clearCookie(action.name, action.options)
    case 'setHeader':
      res.setHeader(action.name, action.value)
      return res
    case 'setStatus':
      return res.status(action.status)
  }
}

const empty: Array<Action> = []

export function fromMiddleware<I, O, L>(middleware: Middleware<I, O, L, void>): RequestHandler {
  return (req, res, next) =>
    middleware
      .exec(new ExpressConnection<I>(req, res, empty))
      .run()
      .then(e =>
        e.fold(next, c => {
          const { actions, res } = c as ExpressConnection<O>
          for (let i = 0; i < actions.length; i++) {
            run(res, actions[i])
          }
          next()
        })
      )
}

export function toMiddleware<I, A>(requestHandler: RequestHandler, f: (req: Request) => A): Middleware<I, I, never, A> {
  return new Middleware(c =>
    right(
      new Task(
        () =>
          new Promise(resolve => {
            const { req, res } = c as ExpressConnection<I>
            requestHandler(req, res, () => resolve([f(req), c]))
          })
      )
    )
  )
}
