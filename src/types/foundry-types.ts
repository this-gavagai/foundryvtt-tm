// TODO: this EventArgs structure needs a significant refactor
import type { Socket } from 'socket.io-client'

export type DocumentEventArgs = UpdateEventArgs | CreateEventArgs | DeleteEventArgs
interface BaseDocumentEventArgs {
  type: 'Combat' | 'Combatant' | 'ChatMessage' | 'User' | 'Actor' | 'Item'
  action: 'update' | 'create' | 'delete'
  operation: ModifyDocumentOperation
  result: ModifyDocumentUpdate[] | string[]
}
export interface UpdateEventArgs extends BaseDocumentEventArgs {
  action: 'update'
  result: ModifyDocumentUpdate[]
}
export interface CreateEventArgs extends BaseDocumentEventArgs {
  action: 'create'
  result: ModifyDocumentUpdate[]
}
export interface DeleteEventArgs extends BaseDocumentEventArgs {
  action: 'delete'
  result: string[]
}
export interface GetEvent {
  action: 'get'
}

export interface UserActivityEventArgs {
  targets: any
}

export interface SessionEventArgs {
  userId: string
}

interface ModifyDocumentOperation {
  diff: boolean
  render: boolean
  parentUuid?: string
  updates?: ModifyDocumentUpdate[]
}

export interface ModifyDocumentUpdate {
  _id: string
  [key: string]: any
}

// Client components
export interface Hooks {
  on: Function
  once: Function
}
export interface Canvas {
  ready: boolean
  app: any
}
export interface Foundry {
  applications: any
}
export interface Game {
  socket: Socket
  user: User
  users: {
    get: Function
    filter: Function
  }
  userId: string
  scenes: any
  data: any
  audio: any
  settings: any
}
export interface User {
  _id: string
  name: string
  getFlag: Function
  isGM: boolean
  active: boolean
  flags: { [key: string]: any }
  targets: any
}

// // modify document socket operations
// export interface EventArgs {
//   action: string
//   uuid: string
//   // request: EventRequest
//   operation: EventOperation
//   result: ModifyResult[]
//   actorId: string
//   characterId: string
//   modifiers: any
//   targets: string[]
//   type: string
//   userId: string
// }

// TODO: these [key: string] values are actually partials of the Actor type. Worth implementing?

// export interface EventOperation {
//   _id: string
//   type: string
//   action: string
//   parentUuid: string
// }

// export interface EventRequest {
//   _id: string
//   type: string
//   action: string
//   parentUuid: string
// }

// export interface EventResponse {
//   result: EventRequest[]
// }
