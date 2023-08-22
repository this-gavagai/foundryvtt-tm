export interface EventsMap {
  getJoinData(callback: (result: GetJoinDataResult) => void): void
  modifyDocument(
    data: ModifyDocumentRequest,
    callback: (result: ModifyDocumentResult) => void
  ): void
  world(callback: (result: WorldResult) => void): void
  'module.keybard'(actorId: any, callback: (result: any) => void): void
}

export interface WorldResult {
  userId: string
  release: any
  world: any
  system: any
  modules: any
  demoMode: boolean
  addresses: any
  files: any
  options: any
  activeUsers: string[]
  documentTypes: any
  template: any
  model: any
  paused: boolean
  users: any[]
  actors: any[]
  cards: any[]
  messages: any[]
  combats: any[]
  folders: any[]
  items: any[]
  journal: any[]
  macros: any[]
  playlists: any[]
  tables: any[]
  scenes: any[]
  packs: any[]
  settings: any[]
  coreUpdate: any
  systemUpdate: any
}

export interface ModifyDocumentRequest {
  type: string
  action: 'update'
  updates: (Record<string, unknown> & { _id: string })[]
  options: { diff: boolean; render: boolean }
  pack: null | unknown
}

export interface ModifyDocumentResult {
  userId: string
  request: ModifyDocumentRequest
  result: (Record<string, unknown> & {
    _id: string
    _stats: {
      modifiedTime: number
      lastModifiedBy: string
    }
  })[]
}

export interface GetJoinDataResult {
  release: {
    generation: number
    channel: string
    suffix: string
    build: number
    node_version: number
    time: number
    notes: string
    download: string
  }
  world: {
    id: string
    title: string
    description: string
    authors: unknown[]
    flags: Record<string, unknown>
    media: unknown[]
    version: string
    compatibility: {
      minimum: string
      verified: string
      maximum: string
    }
    scripts: unknown[]
    esmodules: unknown[]
    styles: unknown[]
    languages: unknown[]
    packs: unknown[]
    relationships: {
      systems: unknown[]
      requires: unknown[]
      conflicts: unknown[]
      flags: Record<string, unknown>
    }
    socket: boolean
    manifest: string
    protected: boolean
    exclusive: boolean
    system: string
    background: string
    coreVersion: string
    systemVersion: string
    nextSession: null | unknown
    resetKeys: boolean
    safeMode: boolean
    availability: 0
    unavailable: boolean
    locked: boolean
    owned: boolean
    tags: unknown[]
  }
  modules: unknown[]
  passwordString: string
  isAdmin: boolean
  users: JoinDataUser[]
  activeUsers: string[]
  userId: null
  options: {
    language: 'en.core'
  }
}

interface JoinDataUser {
  _id: string
  character: null | string
  color: string
  hotbar: Record<string, string>
  name: string
  permissions: Record<string, unknown>
  role: 0 | 1 | 2 | 3 | 4
  flags: Record<string, unknown>
  avatar: null | string
  _stats: {
    systemId: string
    systemVersion: string
    coreVersion: string
    createdTime: null | unknown
    modifiedTime: number
    lastModifiedBy: string
  }
}
