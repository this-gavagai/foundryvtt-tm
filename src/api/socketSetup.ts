import type { Ref } from 'vue'
import { mergeWith } from 'lodash-es'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { ModuleEventArgs } from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useListenersStore } from '@/stores/listenersOnline'
import { logger } from '@/utils/utilities'
import {
  getSocket,
  mergeWithArrayReset,
  type ModifyDocumentUpdate,
  type DocumentData
} from './internal'
import { addRefresh, fireRefresh, parseActorData } from './characterSync'
import { processChanges } from './documents'
import { resolveAck } from './actions'
import { TM } from './protocol'

type AppChannelHandler = (args: ModuleEventArgs) => void
type ModifyDocumentHandler = (args: DocumentSocketResponse) => void
type UserActivityHandler = (user: string, args: { targets?: string[]; active?: boolean }) => void

let appChannelHandler: AppChannelHandler | null = null
let worldModifyHandler: ModifyDocumentHandler | null = null
let worldUserActivityHandler: UserActivityHandler | null = null

export async function setupSocketListenersForApp() {
  const socket = await getSocket()
  const { addListener } = useListenersStore()

  if (appChannelHandler) socket.off(TM.CHANNEL, appChannelHandler)
  appChannelHandler = (args: ModuleEventArgs) => {
    switch (args.action) {
      case TM.ACK:
        resolveAck(args.uuid, args)
        break
      case TM.SHARE_TARGETS: {
        const { updateTargets } = useTargetHelperStore()
        Object.entries(args.targets).forEach(([userId, targets]) =>
          updateTargets(userId, targets as string[])
        )
        break
      }
      case TM.LISTENER_ONLINE:
        addListener(args.userId)
        break
    }
  }
  socket.on(TM.CHANNEL, appChannelHandler)
}

export async function setupSocketListenersForWorld(world: Ref<GamePF2e>) {
  const socket = await getSocket()

  if (worldModifyHandler) socket.off('modifyDocument', worldModifyHandler)
  worldModifyHandler = (args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat':
        processChanges(args, world.value?.combats as unknown as DocumentData[])
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combat = world.value?.combats.find((c) => c._id === combatId)
        processChanges(args, combat?.combatants as unknown as DocumentData[] | undefined)
        break
      }
      case 'ChatMessage':
        processChanges(args, world.value?.messages as unknown as DocumentData[] | undefined)
        break
    }
  }
  socket.on('modifyDocument', worldModifyHandler)

  if (worldUserActivityHandler) socket.off('userActivity', worldUserActivityHandler)
  worldUserActivityHandler = (user: string, args: { targets?: string[]; active?: boolean }) => {
    if (args.targets) {
      logger.info('user event', user, args)
      const { updateTargets } = useTargetHelperStore()
      updateTargets(user, args.targets)
    } else if (args.active) {
      logger.info('user online', user, args)
    }
  }
  socket.on('userActivity', worldUserActivityHandler)
}

export async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateCharacter | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
  const socket = await getSocket()
  const removeRefresh = addRefresh(actorId, refreshMethod)

  const channelHandler = (args: ModuleEventArgs) => {
    switch (args.action) {
      case TM.LISTENER_ONLINE:
        if (!actor.value?.inventory) fireRefresh(actorId)
        break
      case TM.UPDATE_CHARACTER:
        parseActorData(actorId, actor, args)
        break
    }
  }
  socket.on(TM.CHANNEL, channelHandler)

  const modifyHandler = (args: DocumentSocketResponse) => {
    if (!actor.value) return
    switch (args.type) {
      case 'Actor':
        ;(args.result as ModifyDocumentUpdate[]).forEach((result: ModifyDocumentUpdate) => {
          if (result._id === actorId) {
            mergeWith(actor.value, result, mergeWithArrayReset)
            fireRefresh(actorId)
          }
        })
        break
      case 'Item':
        if (args.operation.parentUuid === 'Actor.' + actorId) {
          processChanges(args, actor.value.items as unknown as DocumentData[])
          fireRefresh(actorId)
        }
        break
    }
  }
  socket.on('modifyDocument', modifyHandler)

  return () => {
    socket.off(TM.CHANNEL, channelHandler)
    socket.off('modifyDocument', modifyHandler)
    removeRefresh()
  }
}
