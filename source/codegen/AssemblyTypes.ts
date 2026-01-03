/**
 * 汇编代码生成相关类型定义
 */

/**
 * 寄存器描述符
 */
export interface RegisterDescriptor {
  usable: boolean
  variables: Set<string>
}

/**
 * 地址描述符
 */
export interface AddressDescriptor {
  currentAddresses: Set<string>
  boundMemAddress: string | undefined // 临时变量不应该有内存位置
}

/**
 * 栈帧信息
 * A non-leaf function is one that calls other function(s); 
 * a leaf function is one that does not itself make any function calls.
 */
export interface StackFrameInfo {
  isLeaf: boolean
  wordSize: number
  outgoingSlots: number
  localData: number
  numGPRs2Save: number
  numReturnAdd: number
}

