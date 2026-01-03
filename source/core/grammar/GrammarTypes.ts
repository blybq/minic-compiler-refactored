/**
 * 语法分析相关的类型定义
 */

/**
 * 语法符号类型
 */
export type GrammarSymbolType = 'ascii' | 'token' | 'nonterminal' | 'sptoken'

/**
 * 语法符号
 */
export type GrammarSymbol = {
  type: GrammarSymbolType
  content: string
}

/**
 * 产生式
 */
export type Production = {
  lhs: number // 左部符号索引
  rhs: number[] // 右部符号索引列表
  action: string // 语义动作代码
}

/**
 * ACTION表单元格类型
 */
export type ActionTableCellType = 'shift' | 'reduce' | 'acc' | 'none'

/**
 * ACTION表单元格
 */
export type ActionTableCell = {
  type: ActionTableCellType
  data: number // 状态索引或产生式索引
}

