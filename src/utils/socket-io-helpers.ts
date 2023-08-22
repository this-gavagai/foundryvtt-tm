import { Socket } from 'socket.io-client'

type EventsMap = { [event: string]: any }
type EventNames<Map extends EventsMap> = keyof Map & (string | symbol)
type AnyFunc = (...args: any) => any

type TupleWithoutLastElement<T extends any[]> = T extends [...infer Head, any] ? Head : []

type TupleLastElement<T extends any[]> = T extends [...any[], infer Tail] ? Tail : never

type AsyncEmitArgs<
  EmitEvents extends EventsMap,
  Ev extends EventNames<EmitEvents>
> = TupleLastElement<Parameters<EmitEvents[Ev]>> extends AnyFunc
  ? TupleWithoutLastElement<Parameters<EmitEvents[Ev]>>
  : never

type AsyncEmitReturn<
  EmitEvents extends EventsMap,
  Ev extends EventNames<EmitEvents>
> = TupleLastElement<Parameters<EmitEvents[Ev]>> extends AnyFunc
  ? Parameters<TupleLastElement<Parameters<EmitEvents[Ev]>>>[0]
  : void

export function asyncEmit<
  ListenEvents extends EventsMap,
  EmitEvents extends EventsMap,
  Ev extends EventNames<EmitEvents>
>(socket: Socket<ListenEvents, EmitEvents>, name: Ev, ...args: AsyncEmitArgs<EmitEvents, Ev>) {
  return new Promise<AsyncEmitReturn<EmitEvents, Ev>>((ful) => {
    const realArgs: any = [...args, (resp: any) => ful(resp)]
    socket.emit(name, ...realArgs)
  })
}
