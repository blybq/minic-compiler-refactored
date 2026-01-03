/**
 * Minisys架构相关定义
 */

// prettier-ignore
export const ALL_REGISTERS = [
  '$zero', '$at',
  '$v0', '$v1',
  '$a0', '$a1', '$a2', '$a3',
  '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7', '$t8', '$t9',
  '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
  '$k0', '$k1',
  '$gp', '$sp', '$fp',
  '$ra',
] as const

// prettier-ignore
export const USEFUL_REGISTERS = <const>[
  '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7', '$t8', '$t9', // 子程序可以破坏其中的值
  '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7', // 子程序必须保持前后的值
]

export const WORD_LENGTH_BITS = 32
export const WORD_LENGTH_BYTES = 4
export const RAM_SIZE = 65536 // bytes
export const ROM_SIZE = 65536 // bytes
export const IO_MAX_ADDRESS = 0xffffffff

