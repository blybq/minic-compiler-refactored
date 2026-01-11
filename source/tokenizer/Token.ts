/**
 * Token类型定义
 */

/**
 * Token类型
 */
export interface Token {
  /** Token名称 */
  name: string
  /** Token的字面值 */
  literal: string
  /** 行号（从1开始） */
  lineNumber: number
  /** 在行中的位置（从1开始） */
  position: number
}

