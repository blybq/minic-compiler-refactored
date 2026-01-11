/**
 * 语法分析相关类型定义
 */

/**
 * 语法符号类型
 */
export type GrammarSymbolType = 'ascii' | 'token' | 'nonterminal' | 'sptoken'

/**
 * 语法符号
 */
export interface GrammarSymbol {
  type: GrammarSymbolType
  content: string
}

/**
 * 特殊符号
 */
export const SpecialGrammarSymbols = {
  END: { type: 'sptoken' as GrammarSymbolType, content: 'SP_END' } as GrammarSymbol,
  EPSILON: { type: 'sptoken' as GrammarSymbolType, content: 'SP_EPSILON' } as GrammarSymbol,
}

/**
 * 运算符定义
 */
export interface OperatorDefinition {
  tokenName?: string
  associativity: 'left' | 'right' | 'non'
  precedence: number // 数值越大优先级越高
}

/**
 * 产生式定义
 */
export class ProductionDefinition {
  private readonly _leftHandSide: string
  private readonly _rightHandSide: string[]
  private readonly _actions: string[] // 与rightHandSide一一对应

  get leftHandSide(): string {
    return this._leftHandSide
  }

  get rightHandSide(): string[] {
    return this._rightHandSide
  }

  get actions(): string[] {
    return this._actions
  }

  constructor(leftHandSide: string, rightHandSide: string[], actions: string[]) {
    this._leftHandSide = leftHandSide
    this._rightHandSide = [...rightHandSide]
    this._actions = [...actions]
  }
}
