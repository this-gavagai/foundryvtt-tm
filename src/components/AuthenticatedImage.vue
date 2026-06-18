<script setup lang="ts">
import { CapacitorHttp, type HttpResponse } from '@capacitor/core'
import { computed, onBeforeUnmount, ref, useAttrs, watch } from 'vue'
import { readNativeSession } from '@/api/capacitorServerTransport'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'

const IMAGE_TIMEOUT_MS = 15_000

const props = defineProps<{
  src?: string
}>()

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const serverAddress = useServerAddressStore()
const displaySrc = ref<string>()
let requestId = 0
let objectUrl: string | undefined

const shouldUseNativeHttp = computed(
  () => serverAddress.isNativeMobile && !!props.src && /^https?:\/\//i.test(props.src)
)

function readHeader(response: HttpResponse, headerName: string): string | undefined {
  const target = headerName.toLowerCase()
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === target)
  return entry?.[1]
}

function contentTypeFor(src: string, response: HttpResponse): string {
  const header = readHeader(response, 'content-type')
  if (header) return header.split(';')[0].trim()
  if (/\.svg(?:[?#]|$)/i.test(src)) return 'image/svg+xml'
  if (/\.webp(?:[?#]|$)/i.test(src)) return 'image/webp'
  if (/\.jpe?g(?:[?#]|$)/i.test(src)) return 'image/jpeg'
  if (/\.gif(?:[?#]|$)/i.test(src)) return 'image/gif'
  return 'image/png'
}

function revokeObjectUrl() {
  if (!objectUrl) return
  URL.revokeObjectURL(objectUrl)
  objectUrl = undefined
}

function responseDataToUrl(data: unknown, contentType: string): string | undefined {
  revokeObjectUrl()

  if (data instanceof Blob) {
    objectUrl = URL.createObjectURL(data)
    return objectUrl
  }
  if (data instanceof ArrayBuffer) {
    objectUrl = URL.createObjectURL(new Blob([data], { type: contentType }))
    return objectUrl
  }
  if (typeof data !== 'string') return undefined
  if (data.startsWith('data:') || data.startsWith('blob:')) return data
  if (data.trimStart().startsWith('<')) {
    if (contentType === 'image/svg+xml') {
      return `data:${contentType};charset=utf-8,${encodeURIComponent(data)}`
    }
    return undefined
  }
  return `data:${contentType};base64,${data}`
}

async function loadNativeImage(src: string, currentRequestId: number) {
  const session = readNativeSession()
  const response = await CapacitorHttp.get({
    url: src,
    responseType: 'blob',
    headers: session ? { Cookie: `session=${session}` } : undefined,
    connectTimeout: IMAGE_TIMEOUT_MS,
    readTimeout: IMAGE_TIMEOUT_MS
  })
  if (currentRequestId !== requestId) return
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Image returned ${response.status}`)
  }

  const nextSrc = responseDataToUrl(response.data, contentTypeFor(src, response))
  displaySrc.value = nextSrc ?? src
}

watch(
  () => props.src,
  (src) => {
    const currentRequestId = ++requestId
    revokeObjectUrl()
    displaySrc.value = src

    if (!src || !shouldUseNativeHttp.value) return
    displaySrc.value = undefined
    void loadNativeImage(src, currentRequestId).catch((error) => {
      if (currentRequestId !== requestId) return
      logger.warn('Unable to load native image', { src, error })
      displaySrc.value = src
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  requestId += 1
  revokeObjectUrl()
})
</script>

<template>
  <img v-if="displaySrc" v-bind="attrs" :src="displaySrc" />
</template>
