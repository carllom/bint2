import type { InjectionKey } from 'vue'
import { FileByteSource } from '@/core'
import type { ByteSource } from '@/core'

/**
 * Turns an opened `File` into a {@link ByteSource}. The one seam the shell tests
 * substitute (plan §11): the default builds a real {@link FileByteSource}; tests
 * inject a synthetic or a failing source.
 */
export type ByteSourceFactory = (file: File) => ByteSource

export const defaultByteSourceFactory: ByteSourceFactory = (file) => new FileByteSource(file)

export const byteSourceFactoryKey: InjectionKey<ByteSourceFactory> = Symbol('byteSourceFactory')
