/**
 * 基本块定义
 */

import { InstructionQuad } from './InstructionQuad'

/**
 * 基本块
 */
export interface BasicBlock {
  /** 基本块ID */
  blockId: number
  /** 基本块内容（四元式列表） */
  instructions: InstructionQuad[]
}

