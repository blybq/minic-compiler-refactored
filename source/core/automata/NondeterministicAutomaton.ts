/**
 * 非确定有限状态自动机（NFA）
 * 支持epsilon转移
 */

import {
  StateMachineBase,
  MachineState,
  StateTransition,
  SpecialSymbol,
  StateAction,
} from './StateMachine'
import { requireCondition } from '../utils'
import { RegexInterface } from './RegexInterface'
import { LexParserInterface } from './LexParserInterface'
import { splitStringKeepDelimiters, ESCAPE_TO_CHAR } from '../utils'

/**
 * 非确定有限状态自动机
 */
export class NondeterministicAutomaton extends StateMachineBase {
  private _acceptingStateActions: Map<MachineState, StateAction>

  constructor() {
    super()
    this._initialStates = []
    this._acceptingStates = []
    this._stateList = []
    this._symbolSet = []
    this._transitionTable = []
    this._acceptingStateActions = new Map()
  }

  get acceptingStateActions(): Map<MachineState, StateAction> {
    return this._acceptingStateActions
  }

  /**
   * 创建原子NFA（单个字符或特殊符号的NFA）
   * @param symbol 字符或特殊符号
   * @returns 创建的原子NFA
   */
  static createAtom(symbol: string | number): NondeterministicAutomaton {
    const nfa = new NondeterministicAutomaton()
    nfa._initialStates = [new MachineState()]
    nfa._acceptingStates = [new MachineState()]
    nfa._stateList = [...nfa._initialStates, ...nfa._acceptingStates]

    if (typeof symbol === 'string') {
      nfa._symbolSet = [symbol]
      nfa._transitionTable = [[{ inputSymbol: 0, targetStateIndex: 1 }], []]
    } else {
      // 特殊符号
      nfa._symbolSet = [getSpecialSymbolString(symbol)]
      nfa._transitionTable = [[{ inputSymbol: symbol, targetStateIndex: 1 }], []]
    }

    return nfa
  }

  /**
   * 深拷贝NFA，创建新的状态对象
   * @param nfa 要拷贝的NFA
   * @returns 拷贝后的新NFA
   */
  static clone(nfa: NondeterministicAutomaton): NondeterministicAutomaton {
    const cloned = new NondeterministicAutomaton()
    cloned._stateList = []
    cloned._initialStates = []
    cloned._acceptingStates = []

    for (let i = 0; i < nfa._stateList.length; i++) {
      const originalState = nfa._stateList[i]
      let newState: MachineState
      if (nfa._initialStates.includes(originalState)) {
        newState = new MachineState()
        cloned._initialStates.push(newState)
        cloned._stateList[i] = newState
      } else if (nfa._acceptingStates.includes(originalState)) {
        newState = new MachineState()
        cloned._acceptingStates.push(newState)
        cloned._stateList[i] = newState
      } else {
        newState = new MachineState()
        cloned._stateList[i] = newState
      }
    }

    cloned._symbolSet = [...nfa._symbolSet]
    cloned._transitionTable = JSON.parse(JSON.stringify(nfa._transitionTable))
    cloned._acceptingStateActions = new Map(nfa._acceptingStateActions)

    return cloned
  }

  /**
   * 计算epsilon闭包：从状态集合只通过epsilon边能到达的所有状态（包括自身）
   * @param states 状态集合
   * @returns epsilon闭包
   */
  computeEpsilonClosure(states: MachineState[]): MachineState[] {
    const result = [...states]
    for (let i = 0; i < result.length; i++) {
      const epsilonTransitions = this.getTransitionsFromState(result[i], [SpecialSymbol.EPSILON])
      const reachableStates = epsilonTransitions.map(
        transition => this._stateList[transition.targetStateIndex]
      )
      const newStates = reachableStates.filter(state => !result.includes(state))
      result.push(...newStates)
    }
    return result
  }

  /**
   * move操作：从状态集合通过一个字符能到达的状态（不考虑epsilon边）
   * @param states 状态集合
   * @param symbolIndex 字符在字母表中的索引
   * @returns 能到达的状态集合
   */
  computeStateMove(states: MachineState[], symbolIndex: number): MachineState[] {
    const result: MachineState[] = []
    for (const state of states) {
      const transitions = this.getTransitionsFromState(state)
      for (const transition of transitions) {
        if (
          transition.inputSymbol === symbolIndex ||
          (transition.inputSymbol === SpecialSymbol.ANY_CHAR && this._symbolSet[symbolIndex] !== '\n')
        ) {
          const targetState = this._stateList[transition.targetStateIndex]
          if (!result.includes(targetState)) {
            result.push(targetState)
          }
        }
      }
    }
    return result
  }

  /**
   * expand操作：从状态通过字符能到达的状态（考虑epsilon边的前后扩展）
   * @param state 起始状态
   * @param symbolIndex 字符在字母表中的索引
   * @returns 能到达的状态集合
   */
  computeStateExpansion(state: MachineState, symbolIndex: number): MachineState[] {
    // 先计算epsilon闭包（前置扩展）
    const preExpanded = this.computeEpsilonClosure([state])
    // 然后进行move操作
    const afterMove = this.computeStateMove(preExpanded, symbolIndex)
    // 最后再计算epsilon闭包（后置扩展）
    return this.computeEpsilonClosure(afterMove)
  }

  /**
   * 应用Kleene闭包（*）：将当前NFA原地做Kleene闭包
   * 添加新的开始和接受状态，通过epsilon边连接
   */
  applyKleeneClosure(): void {
    const oldInitialStates = [...this._initialStates]
    const oldAcceptingStates = [...this._acceptingStates]

    // 创建新的开始状态
    const newInitialState = new MachineState()
    this._initialStates = [newInitialState]
    this._stateList.push(newInitialState)
    this._transitionTable.push([])

    // 创建新的接受状态
    const newAcceptingState = new MachineState()
    this._acceptingStates = [newAcceptingState]
    this._stateList.push(newAcceptingState)
    this._transitionTable.push([])

    // new_start --epsilon--> old_start
    this.addEpsilonTransitions(this._initialStates, oldInitialStates)
    // old_accept --epsilon--> new_accept
    this.addEpsilonTransitions(oldAcceptingStates, this._acceptingStates)
    // new_start --epsilon--> new_accept
    this.addEpsilonTransitions(this._initialStates, this._acceptingStates)
    // old_accept --epsilon--> old_start (循环)
    this.addEpsilonTransitions(oldAcceptingStates, oldInitialStates)
  }

  /**
   * 在状态之间添加转移边
   * @param sourceStates 源状态列表
   * @param targetStates 目标状态列表
   * @param symbolIndex 输入符号在字母表中的索引
   */
  addTransitions(sourceStates: MachineState[], targetStates: MachineState[], symbolIndex: number): void {
    for (const sourceState of sourceStates) {
      const transitions = this.getTransitionsFromState(sourceState)
      for (const targetState of targetStates) {
        const targetIndex = this._stateList.indexOf(targetState)
        requireCondition(targetIndex !== -1, '目标状态不在状态列表中')
        transitions.push({
          inputSymbol: symbolIndex,
          targetStateIndex: targetIndex,
        })
      }
      this.setTransitionsFromState(sourceState, transitions)
    }
  }

  /**
   * 在状态之间添加epsilon转移边
   * @param sourceStates 源状态列表
   * @param targetStates 目标状态列表
   */
  addEpsilonTransitions(sourceStates: MachineState[], targetStates: MachineState[]): void {
    this.addTransitions(sourceStates, targetStates, SpecialSymbol.EPSILON)
  }

  /**
   * 合并两个NFA的转移表（用于串联和并联操作）
   * 注意：调用此方法前，必须确保目标NFA的字母表和状态列表已经合并
   * @param from 源NFA
   * @param to 目标NFA（会被修改）
   */
  private static mergeTransitionTable(
    from: NondeterministicAutomaton,
    to: NondeterministicAutomaton
  ): void {
    for (let i = 0; i < from._transitionTable.length; i++) {
      const transitions = from._transitionTable[i]
      const mergedTransitions: StateTransition[] = []

      for (const transition of transitions) {
        let symbolIndexInTo: number
        if (transition.inputSymbol < 0) {
          // 特殊符号，直接使用
          symbolIndexInTo = transition.inputSymbol
        } else {
          // 普通字符，在目标NFA的字母表中查找（应该已经存在）
          symbolIndexInTo = to._symbolSet.indexOf(from._symbolSet[transition.inputSymbol])
          requireCondition(
            symbolIndexInTo !== -1,
            '字符不在目标NFA的字母表中，请确保先合并字母表'
          )
        }

        const targetIndexInTo = to._stateList.indexOf(from._stateList[transition.targetStateIndex])
        requireCondition(targetIndexInTo !== -1, '目标状态不在状态列表中')

        mergedTransitions.push({
          inputSymbol: symbolIndexInTo,
          targetStateIndex: targetIndexInTo,
        })
      }

      to._transitionTable.push(mergedTransitions)
    }
  }

  /**
   * 串联两个NFA：NFA1的接受状态通过epsilon边连接到NFA2的开始状态
   * @param nfa1 第一个NFA
   * @param nfa2 第二个NFA
   * @returns 串联后的新NFA
   */
  static concatenate(
    nfa1: NondeterministicAutomaton,
    nfa2: NondeterministicAutomaton
  ): NondeterministicAutomaton {
    const result = new NondeterministicAutomaton()

    result._initialStates = [...nfa1._initialStates]
    result._acceptingStates = [...nfa2._acceptingStates]
    result._stateList = [...nfa1._stateList, ...nfa2._stateList]

    // 合并字母表（去重，注意顺序可能改变）
    result._symbolSet = [...new Set([...nfa1._symbolSet, ...nfa2._symbolSet])]

    // 初始化转移表（先为空，等待合并）
    result._transitionTable = []

    // 合并转移表（必须在字母表合并之后）
    NondeterministicAutomaton.mergeTransitionTable(nfa1, result)
    NondeterministicAutomaton.mergeTransitionTable(nfa2, result)

    // nfa1的接受状态通过epsilon边连接到nfa2的开始状态
    result.addEpsilonTransitions(nfa1._acceptingStates, nfa2._initialStates)

    return result
  }

  /**
   * 并联两个NFA（并运算）：创建新的开始和接受状态，通过epsilon边连接
   * @param nfa1 第一个NFA
   * @param nfa2 第二个NFA
   * @returns 并联后的新NFA
   */
  static union(nfa1: NondeterministicAutomaton, nfa2: NondeterministicAutomaton): NondeterministicAutomaton {
    const result = new NondeterministicAutomaton()

    result._initialStates = [new MachineState()]
    result._acceptingStates = [new MachineState()]

    result._symbolSet = [...new Set([...nfa1._symbolSet, ...nfa2._symbolSet])]
    result._stateList = [
      ...result._initialStates,
      ...nfa1._stateList,
      ...nfa2._stateList,
      ...result._acceptingStates,
    ]

    result._transitionTable = [[]] // 新开始状态的转移表
    NondeterministicAutomaton.mergeTransitionTable(nfa1, result)
    NondeterministicAutomaton.mergeTransitionTable(nfa2, result)
    result._transitionTable.push([]) // 新接受状态的转移表

    // 连接新开始状态到两个NFA的开始状态
    result.addEpsilonTransitions(result._initialStates, nfa1._initialStates)
    result.addEpsilonTransitions(result._initialStates, nfa2._initialStates)

    // 连接两个NFA的接受状态到新接受状态
    result.addEpsilonTransitions(nfa1._acceptingStates, result._acceptingStates)
    result.addEpsilonTransitions(nfa2._acceptingStates, result._acceptingStates)

    return result
  }

  /**
   * 并联多个NFA（用于词法分析器）：创建新的开始状态，连接到所有NFA的开始状态
   * @param nfas NFA数组
   * @returns 并联后的新NFA
   */
  static unionAll(...nfas: NondeterministicAutomaton[]): NondeterministicAutomaton {
    const result = new NondeterministicAutomaton()

    result._initialStates = [new MachineState()]
    result._stateList = [...result._initialStates]

    const tempSymbolSet: string[] = []

    for (const nfa of nfas) {
      result._acceptingStates.push(...nfa._acceptingStates)
      result._stateList.push(...nfa._stateList)

      // 复制接受状态的动作映射
      for (const state of nfa._acceptingStates) {
        const action = nfa._acceptingStateActions.get(state)
        if (action) {
          result._acceptingStateActions.set(state, action)
        }
      }

      tempSymbolSet.push(...nfa._symbolSet)
    }

    result._symbolSet = [...new Set(tempSymbolSet)]
    result._transitionTable = [[]] // 新开始状态的转移表

    // 合并所有NFA的转移表
    for (const nfa of nfas) {
      NondeterministicAutomaton.mergeTransitionTable(nfa, result)
    }

    // 连接新开始状态到所有NFA的开始状态
    for (const nfa of nfas) {
      result.addEpsilonTransitions(result._initialStates, nfa._initialStates)
    }

    return result
  }

  /**
   * 从正则表达式构造NFA
   * 使用后缀表达式解析算法，支持 |、*、+、?、.、转义字符等操作符
   * @param regex 正则表达式对象
   * @param action 可选的接受状态动作
   * @returns 构造的NFA
   */
  static buildFromRegex(regex: RegexInterface, action?: StateAction): NondeterministicAutomaton {
    // 后缀表达式使用空格分隔，先按空格分割，然后处理每个部分
    const parts = regex.postFix.split(/\s+/).filter(p => p.length > 0)
    const stack: NondeterministicAutomaton[] = []
    let waitingEscapeDetail = false

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      if (part.length === 0) {
        // 空格跳过
        continue
      }

      if (waitingEscapeDetail) {
        // 处理转义字符
        const escapeKey = `\\${part}`
        const escapedChar = ESCAPE_TO_CHAR[escapeKey] || part
        stack.push(NondeterministicAutomaton.createAtom(escapedChar))
        waitingEscapeDetail = false
        continue
      }

      switch (part) {
        case '|': {
          // 或运算符
          const operand2 = stack.pop()!
          const operand1 = stack.pop()!
          requireCondition(operand1 !== undefined && operand2 !== undefined, '缺少操作数用于或运算')
          stack.push(NondeterministicAutomaton.union(operand1, operand2))
          break
        }
        case '[dot]': {
          // 连接运算符
          const operand2 = stack.pop()!
          const operand1 = stack.pop()!
          requireCondition(operand1 !== undefined && operand2 !== undefined, '缺少操作数用于连接运算')
          stack.push(NondeterministicAutomaton.concatenate(operand1, operand2))
          break
        }
        case '*': {
          // Kleene闭包（星闭包）
          const operand = stack[stack.length - 1]
          requireCondition(operand !== undefined, '缺少操作数用于星闭包运算')
          operand.applyKleeneClosure()
          break
        }
        case '+': {
          // 正闭包：A+ 转换为 AA*
          const operand = stack.pop()!
          requireCondition(operand !== undefined, '缺少操作数用于正闭包运算')
          const operandCopy = NondeterministicAutomaton.clone(operand)
          operandCopy.applyKleeneClosure()
          stack.push(NondeterministicAutomaton.concatenate(operand, operandCopy))
          break
        }
        case '?': {
          // 0或1次：A? 转换为 A|ε
          const operand = stack.pop()!
          requireCondition(operand !== undefined, '缺少操作数用于可选运算')
          // 在开始状态和接受状态之间添加epsilon边
          operand.addEpsilonTransitions(operand._initialStates, operand._acceptingStates)
          stack.push(operand)
          break
        }
        case '\\': {
          // 转义符
          waitingEscapeDetail = true
          break
        }
        case '.': {
          // 任意字符（除换行符外）
          stack.push(NondeterministicAutomaton.createAtom(SpecialSymbol.ANY_CHAR))
          break
        }
        case '[ws]': {
          // 空格字符
          stack.push(NondeterministicAutomaton.createAtom(' '))
          break
        }
        default: {
          // 普通字符
          stack.push(NondeterministicAutomaton.createAtom(part[0]))
          break
        }
      }
    }

    requireCondition(stack.length === 1, `NFA构造后栈大小不正确，应为1，实际为${stack.length}。正则表达式: ${regex.raw}`)
    const result = stack.pop()!

    // 如果提供了动作，将其设置到所有接受状态
    if (action) {
      for (const state of result._acceptingStates) {
        result._acceptingStateActions.set(state, action)
      }
    }

    return result
  }

  /**
   * 从LexParser构造大NFA
   * 将LexParser中的所有正则表达式转换为NFA，然后并联所有NFA
   * @param lexParser LexParser对象
   * @returns 并联后的NFA
   */
  static buildFromLexParser(lexParser: LexParserInterface): NondeterministicAutomaton {
    const nfas: NondeterministicAutomaton[] = []

    // 为每个正则表达式创建NFA
    for (const [regex, action] of lexParser.regexActionMap.entries()) {
      nfas.push(NondeterministicAutomaton.buildFromRegex(regex, action))
    }

    // 并联所有NFA
    return NondeterministicAutomaton.unionAll(...nfas)
  }
}

/**
 * 获取特殊符号的字符串表示（用于字母表）
 */
function getSpecialSymbolString(symbol: number): string {
  const symbolMap: { [key: number]: string } = {
    [SpecialSymbol.EPSILON]: '[ε]',
    [SpecialSymbol.ANY_CHAR]: '[any]',
    [SpecialSymbol.OTHER_CHAR]: '[other]',
  }
  return symbolMap[symbol] || ''
}

