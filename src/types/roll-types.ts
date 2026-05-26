import type { RequestResolutionArgs } from './api-types'

export interface Roll {
  key: string
  label: string
  color?: 'blue' | 'red' | 'green' | 'lightgray'
  dice?: string[]
  disabled?: boolean
  armed?: boolean
  execute: (faces?: number[]) => Promise<RequestResolutionArgs | null | undefined>
}
