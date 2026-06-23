import { computed, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePixelDiceStore } from '@/stores/pixelDice'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'

interface UseInfoModalRollsOptions {
  rolls: Ref<Roll[] | undefined>
  isOpen: Ref<boolean>
  onRollResolved: (result: RequestResolutionArgs | null | undefined) => void
  onRollError?: (error: unknown) => void
}

export function useInfoModalRolls({
  rolls,
  isOpen,
  onRollResolved,
  onRollError = (error) => console.error('Failed to execute roll', error)
}: UseInfoModalRollsOptions) {
  const { lastRoll, readyFaceCounts } = storeToRefs(usePixelDiceStore())

  // The roll that consumes the next physical-die input: prefer an explicitly
  // armed roll; otherwise the first dice-eligible roll.
  const armedRoll = computed<Roll | undefined>(() => {
    const list = rolls.value ?? []
    return (
      list.find((roll) => roll.armed && roll.dice?.length) ?? list.find((roll) => roll.dice?.length)
    )
  })

  // Whether any of the armed roll's dice has a matching ready physical die —
  // gates the whole bouncing-dice affordance.
  const hasReadyPixel = computed(() =>
    (armedRoll.value?.dice ?? []).some((die) => readyFaceCounts.value.has(Number(die.slice(1))))
  )

  // Per-die face selections for the armed roll. The buffer is always sized to
  // the armed roll's dice list so manual face-picking can address any slot
  // directly. For Pixel input we fill the next empty slot in order. A single-
  // die roll (d20 check) fills and fires in one step; multi-die rolls (e.g.
  // 2d8+1d6) accumulate across rolls or picks until every slot is filled.
  const buffer = ref<(number | undefined)[]>([])

  function emptyBuffer(): (number | undefined)[] {
    return (armedRoll.value?.dice ?? []).map(() => undefined)
  }

  const bufferComplete = computed(
    () => buffer.value.length > 0 && buffer.value.every((value) => value !== undefined)
  )

  // Reset the buffer whenever arming switches to a different roll — partially
  // collected faces for the old roll shouldn't carry over.
  watch(
    () => armedRoll.value?.key,
    () => {
      buffer.value = emptyBuffer()
    }
  )

  // Also re-shape the buffer if the armed roll's dice list changes (e.g. the
  // damage formula resolves asynchronously or swaps same-count dice like d6->d8).
  watch(
    () => armedRoll.value?.dice?.join('|') ?? '',
    () => {
      buffer.value = emptyBuffer()
    }
  )

  async function executeRoll(roll: Roll, faces?: number[]) {
    if (roll.disabled) return
    buffer.value = emptyBuffer()
    try {
      const result = await roll.execute(faces)
      onRollResolved(result)
    } catch (error) {
      onRollError(error)
    }
  }

  // Roll buttons clicked manually: use the buffer only if the armed roll is the
  // one being fired and every face is selected.
  function executeRollFromButton(roll: Roll) {
    const isArmed = roll.key === armedRoll.value?.key
    if (isArmed && bufferComplete.value) {
      return executeRoll(roll, buffer.value as number[])
    } else {
      return executeRoll(roll)
    }
  }

  watch(lastRoll, () => {
    const roll = armedRoll.value
    const event = lastRoll.value
    if (!isOpen.value || !roll?.dice?.length || !event) return
    // Match physical dice to roll slots by face count: a d20 can't fill a d6
    // slot, etc. Within matching slots we fill the first empty one in order,
    // so multi-d8 damage rolls etc. still accumulate naturally. Non-matching
    // rolls are silently ignored (the slot's bouncy icon stays armed and the
    // user can try the right die or use the manual face picker).
    const idx = buffer.value.findIndex(
      (value, index) =>
        value === undefined && Number(roll.dice![index].slice(1)) === event.dieFaceCount
    )
    if (idx === -1) return
    const next = [...buffer.value]
    next[idx] = event.face
    if (next.every((value) => value !== undefined)) executeRoll(roll, next as number[])
    else buffer.value = next
  })

  function pickFace(slot: number, value: number) {
    const next = [...buffer.value]
    next[slot] = next[slot] === value ? undefined : value
    buffer.value = next
  }

  function clearBuffer() {
    buffer.value = emptyBuffer()
  }

  function dieFaces(die: string): number[] {
    const faces = Number(die.slice(1))
    return Array.from({ length: faces }, (_, index) => index + 1)
  }

  return {
    armedRoll,
    buffer,
    bufferComplete,
    emptyBuffer,
    executeRoll,
    executeRollFromButton,
    pickFace,
    clearBuffer,
    dieFaces,
    hasReadyPixel,
    readyFaceCounts
  }
}
