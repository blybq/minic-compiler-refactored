/**
 * LALR分析器接口（最小化接口，用于语法分析）
 * 这个接口只包含语法分析器需要的最小功能
 */

import { GrammarSymbol, Production, ActionTableCell } from './GrammarTypes'

/**
 * LALR分析器接口
 */
export interface ILALRAnalyzer {
  /** 语法符号列表 */
  symbols: GrammarSymbol[]
  /** 产生式列表 */
  producers: Production[]
  /** ACTION表 */
  ACTIONTable: ActionTableCell[][]
  /** GOTO表 */
  GOTOTable: number[][]
  /** DFA的初始状态ID */
  startStateId: number
  /** 获取产生式的左部符号名称 */
  getLeftHandSide(producerIndex: number): string
}

