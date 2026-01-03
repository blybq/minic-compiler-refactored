/**
 * LexParser接口定义
 * 用于 NondeterministicAutomaton.buildFromLexParser 方法
 */

import { RegexInterface } from './RegexInterface'
import { StateAction } from './StateMachine'

/**
 * LexParser接口
 * 提供正则表达式到动作的映射
 */
export interface LexParserInterface {
  /**
   * 正则表达式到动作的映射表
   */
  readonly regexActionMap: Map<RegexInterface, StateAction>
}

