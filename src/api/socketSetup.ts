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

export async function setupSocketListenersForApp() {
  const socket = await getSocket()
  const { addListener } = useListenersStore()
  socket.on(TM.CHANNEL, (args: ModuleEventArgs) => {
    switch (args.action) {
      case TM.ACK:
        resolveAck(args.uuid, args)
        break
      case TM.SHARE_TARGETS:
        const { updateTargets } = useTargetHelperStore()
        Object.entries(args.targets).forEach(([userId, targets]) =>
          updateTargets(userId, targets as string[])
        )
        break
      case TM.LISTENER_ONLINE:
        logger.info('listener online!', args)
        addListener(args.userId)
        break
    }
  })
}

export async function setupSocketListenersForWorld(world: Ref<GamePF2e>) {
  const socket = await getSocket()

  socket.on('modifyDocument', (args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat':
        processChanges(args, world.value.combats as unknown as DocumentData[])
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
  })
  socket.on('userActivity', (user: string, args: { targets?: string[]; active?: boolean }) => {
    if (args.targets) {
      logger.info('user event', user, args)
      const { updateTargets } = useTargetHelperStore()
      updateTargets(user, args.targets)
    } else if (args.active) {
      logger.info('user online', user, args)
    }
  })
}

export async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateCharacter | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
  const socket = await getSocket()
  const removeRefresh = addRefresh(actorId, refreshMethod)
  socket.on(TM.CHANNEL, (args: ModuleEventArgs) => {
    switch (args.action) {
      case TM.LISTENER_ONLINE:
        if (!actor.value?.inventory) fireRefresh(actorId)
        break
      case TM.UPDATE_CHARACTER:
        parseActorData(actorId, actor, args)
        break
    }
  })
  socket.on('modifyDocument', (args: DocumentSocketResponse) => {
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
  })
  return removeRefresh
}
