import type { ComputedRef, WritableComputedRef } from 'vue'

export type Field<T> = ComputedRef<T | undefined>
export type WritableField<T> = WritableComputedRef<T | undefined>
export type Prop<T> = T | undefined
export type Maybe<T> = T | undefined
