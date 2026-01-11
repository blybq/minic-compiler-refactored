/**
 * 自动机构建器
 * 从词法规则构建NFA，然后转换为DFA，并序列化为JSON
 */

import { LexFileParser, LexRuleAction } from './LexFileParser'
import { RegexEngine } from './RegexEngine'
import { NondeterministicAutomaton } from '../../core/automata/NondeterministicAutomaton'
import { DeterministicAutomaton } from '../../core/automata/DeterministicAutomaton'
import { StateAction } from '../../core/automata/StateMachine'
import { RegexInterface } from '../../core/automata/RegexInterface'

/**
 * 正则表达式适配器，将RegexEngine适配为RegexInterface
 */
class RegexAdapter implements RegexInterface {
  private readonly _engine: RegexEngine

  constructor(engine: RegexEngine) {
    this._engine = engine
  }

  get raw(): string {
    return this._engine.original
  }

  get postFix(): string {
    return this._engine.postfix
  }
}

/**
 * 自动机构建器
 */
export class AutomatonBuilder {
  /**
   * 从词法文件解析器构建DFA
   * @param parser 词法文件解析器
   * @returns 构建的DFA
   */
  static buildFromLexParser(parser: LexFileParser): DeterministicAutomaton {
    // 为每个正则表达式规则构建NFA
    const nfas: NondeterministicAutomaton[] = []

    for (const [regexStr, action] of parser.rules.entries()) {
      // 处理正则表达式
      const regexEngine = new RegexEngine(regexStr)
      const regexAdapter = new RegexAdapter(regexEngine)

      // 构建NFA
      const stateAction: StateAction = {
        order: action.order,
        code: action.code,
      }
      const nfa = NondeterministicAutomaton.buildFromRegex(regexAdapter, stateAction)
      nfas.push(nfa)
    }

    // 并联所有NFA
    const combinedNFA = NondeterministicAutomaton.unionAll(...nfas)

    // 转换为DFA
    const dfa = DeterministicAutomaton.fromNFA(combinedNFA)

    return dfa
  }

  /**
   * 从.l文件构建DFA并序列化为JSON
   * @param lexFilePath .l文件路径
   * @param outputPath 输出JSON文件路径
   * @param description 可选的描述信息
   */
  static buildAndSerialize(lexFilePath: string, outputPath: string, description?: string): void {
    // 解析.l文件
    const parser = new LexFileParser(lexFilePath)

    // 构建DFA
    const dfa = AutomatonBuilder.buildFromLexParser(parser)

    // 序列化
    const desc = description || `从 ${lexFilePath} 生成 @ ${new Date().toLocaleDateString()}`
    dfa.serialize(desc, outputPath)
  }
}
