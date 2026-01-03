/**
 * LALR分析器加载器：从JSON文件加载LALR分析表
 */

import * as fs from 'fs'
import { ILALRAnalyzer } from './LALRAnalyzerInterface'
import { GrammarSymbol, Production, ActionTableCell } from './GrammarTypes'

/**
 * LALR分析表JSON格式
 */
type LALRTableJSON = {
  desc: string
  symbols: GrammarSymbol[]
  producers: Array<{
    _lhs: number
    _rhs: number[]
    _action: string
  }>
  ACTIONTable: ActionTableCell[][]
  GOTOTable: number[][]
  dfa: {
    _startStateId: number
  }
}

/**
 * LALR分析器的简单实现（仅用于语法分析）
 */
class LALRAnalyzerImpl implements ILALRAnalyzer {
  symbols: GrammarSymbol[] = []
  producers: Production[] = []
  ACTIONTable: ActionTableCell[][] = []
  GOTOTable: number[][] = []
  startStateId: number = 0

  getLeftHandSide(producerIndex: number): string {
    const producer = this.producers[producerIndex]
    if (!producer) {
      throw new Error(`产生式索引超出范围：${producerIndex}`)
    }
    const symbol = this.symbols[producer.lhs]
    return symbol ? symbol.content : ''
  }
}

/**
 * 从JSON文件加载LALR分析表
 * @param filePath JSON文件路径
 * @returns LALR分析器接口
 */
export function loadLALRAnalyzer(filePath: string): ILALRAnalyzer {
  const fileContent = fs.readFileSync(filePath, 'utf-8')
  const data: LALRTableJSON = JSON.parse(fileContent)

  const analyzer = new LALRAnalyzerImpl()
  analyzer.symbols = data.symbols
  analyzer.producers = data.producers.map(p => ({
    lhs: p._lhs,
    rhs: p._rhs,
    action: p._action,
  }))
  analyzer.ACTIONTable = data.ACTIONTable
  analyzer.GOTOTable = data.GOTOTable
  analyzer.startStateId = data.dfa._startStateId

  return analyzer
}

