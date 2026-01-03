/**
 * 确定有限状态自动机（DFA）
 * 使用子集构造法从NFA构造DFA
 */

import {
  StateMachineBase,
  MachineState,
  StateTransition,
  SpecialSymbol,
  StateAction,
} from './StateMachine'
import { NondeterministicAutomaton } from './NondeterministicAutomaton'
import * as fs from 'fs'
import { requireCondition } from '../utils'

/**
 * 确定有限状态自动机
 */
export class DeterministicAutomaton extends StateMachineBase {
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
   * 从状态读取一个输入符号后能到达的状态
   * @param state 当前状态
   * @param symbolIndex 输入符号在字母表中的索引
   * @returns 下一个状态，如果无法转移则返回null
   */
  getNextState(state: MachineState, symbolIndex: number): MachineState | null {
    const transitions = this.getTransitionsFromState(state)
    let fallbackTarget: number | null = null

    for (const transition of transitions) {
      if (
        transition.inputSymbol === symbolIndex ||
        (transition.inputSymbol === SpecialSymbol.ANY_CHAR && this._symbolSet[symbolIndex] !== '\n')
      ) {
        return this._stateList[transition.targetStateIndex]
      } else if (transition.inputSymbol === SpecialSymbol.OTHER_CHAR) {
        fallbackTarget = transition.targetStateIndex
      }
    }

    return fallbackTarget !== null ? this._stateList[fallbackTarget] : null
  }

  /**
   * 在状态之间添加转移边
   * @param sourceStates 源状态列表
   * @param targetState 目标状态
   * @param symbolIndex 输入符号在字母表中的索引
   */
  addTransition(sourceStates: MachineState[], targetState: MachineState, symbolIndex: number): void {
    const targetIndex = this._stateList.indexOf(targetState)
    requireCondition(targetIndex !== -1, '目标状态不在状态列表中')

    for (const sourceState of sourceStates) {
      const transitions = this.getTransitionsFromState(sourceState)
      transitions.push({
        inputSymbol: symbolIndex,
        targetStateIndex: targetIndex,
      })
      this.setTransitionsFromState(sourceState, transitions)
    }
  }

  /**
   * 使用子集构造法从NFA构造DFA
   * @param nfa 非确定有限状态自动机
   * @returns 构造的DFA
   */
  static fromNFA(nfa: NondeterministicAutomaton): DeterministicAutomaton {
    const dfa = new DeterministicAutomaton()

    if (nfa.initialStates.length === 0) {
      return dfa
    }

    // 设置字母表
    dfa._symbolSet = [...nfa.symbolSet]

    // 状态集合列表，每个元素是一个NFA状态集合，对应DFA的一个状态
    const nfaStateSets: MachineState[][] = []
    // 第一个状态集合是NFA初始状态的epsilon闭包
    nfaStateSets.push(nfa.computeEpsilonClosure(nfa.initialStates))

    // 创建DFA的第一个状态（初始状态）
    const firstDfaState = new MachineState()
    dfa._initialStates = [firstDfaState]
    dfa._stateList = [firstDfaState]
    dfa._transitionTable = [[]]

    // 检查第一个状态集合中是否包含NFA的接受状态
    for (const nfaState of nfaStateSets[0]) {
      if (nfa.acceptingStates.includes(nfaState)) {
        const action = nfa.acceptingStateActions.get(nfaState)
        if (action) {
          const existingAction = dfa._acceptingStateActions.get(firstDfaState)
          if (existingAction) {
            // 如果已有动作，比较优先级
            if (existingAction.order > action.order) {
              dfa._acceptingStateActions.set(firstDfaState, action)
            }
          } else {
            // 没有重复，添加为接受状态
            dfa._acceptingStates.push(firstDfaState)
            dfa._acceptingStateActions.set(firstDfaState, action)
          }
        }
      }
    }

    // 遍历DFA的每个状态，计算转移
    for (let i = 0; i < dfa._stateList.length; i++) {
      let anyCharTargetStateIndex: number | null = null // ANY_CHAR转移的目标状态索引

      // 对每个输入符号计算转移
      for (let symbolIndex = 0; symbolIndex < dfa._symbolSet.length; symbolIndex++) {
        // 计算从当前NFA状态集合通过该符号能到达的NFA状态集合
        const reachableNfaStates = nfa.computeStateMove(nfaStateSets[i], symbolIndex)
        if (reachableNfaStates.length === 0) {
          continue // 无法转移
        }

        const newNfaStateSet = nfa.computeEpsilonClosure(reachableNfaStates)

        // 查找这个NFA状态集合是否已经存在
        let existingIndex = -1
        for (let j = 0; j < nfaStateSets.length; j++) {
          const existingSet = nfaStateSets[j]
          // 判断两个集合是否相等
          if (
            existingSet.length === newNfaStateSet.length &&
            existingSet.every(state => newNfaStateSet.includes(state)) &&
            newNfaStateSet.every(state => existingSet.includes(state))
          ) {
            existingIndex = j
            break
          }
        }

        // 如果不存在，创建新的DFA状态
        if (existingIndex === -1) {
          existingIndex = nfaStateSets.length
          nfaStateSets.push(newNfaStateSet)

          const newDfaState = new MachineState()
          dfa._stateList.push(newDfaState)
          dfa._transitionTable.push([])

          // 检查新状态集合中是否包含NFA的接受状态
          for (const nfaState of newNfaStateSet) {
            if (nfa.acceptingStates.includes(nfaState)) {
              const action = nfa.acceptingStateActions.get(nfaState)
              if (action) {
                const existingAction = dfa._acceptingStateActions.get(newDfaState)
                if (existingAction) {
                  if (existingAction.order > action.order) {
                    dfa._acceptingStateActions.set(newDfaState, action)
                  }
                } else {
                  dfa._acceptingStates.push(newDfaState)
                  dfa._acceptingStateActions.set(newDfaState, action)
                }
              }
            }
          }
        }

        // 添加转移
        // 检查是否为ANY_CHAR符号（在字母表中存储为"[any]"字符串）
        if (dfa._symbolSet[symbolIndex] === '[any]') {
          anyCharTargetStateIndex = existingIndex
        } else {
          dfa._transitionTable[i].push({
            inputSymbol: symbolIndex,
            targetStateIndex: existingIndex,
          })
        }
      }

      // 处理ANY_CHAR转移
      if (anyCharTargetStateIndex !== null) {
        // 移除指向同一目标的重复转移
        for (let k = dfa._transitionTable[i].length - 1; k >= 0; k--) {
          if (dfa._transitionTable[i][k].targetStateIndex === anyCharTargetStateIndex) {
            dfa._transitionTable[i].splice(k, 1)
          }
        }

        if (dfa._transitionTable[i].length === 0) {
          // 如果转移表为空，使用ANY_CHAR
          dfa._transitionTable[i].push({
            inputSymbol: SpecialSymbol.ANY_CHAR,
            targetStateIndex: anyCharTargetStateIndex,
          })
        } else {
          // 否则使用OTHER_CHAR作为fallback
          dfa._transitionTable[i].push({
            inputSymbol: SpecialSymbol.OTHER_CHAR,
            targetStateIndex: anyCharTargetStateIndex,
          })
        }
      }
    }

    return dfa
  }

  /**
   * 序列化DFA到文件
   * @param description 描述信息
   * @param filePath 保存路径
   */
  serialize(description: string, filePath: string): void {
    const serializedData: DFASerializedData = {
      description,
      symbolSet: Array.from(this._symbolSet),
      stateCount: this._stateList.length,
      initialStateIndices: this._initialStates.map(state => this._stateList.indexOf(state)),
      acceptingStateIndices: this._acceptingStates.map(state => this._stateList.indexOf(state)),
      transitionTable: Array.from(this._transitionTable),
      acceptingStateActions: [],
    }

    for (const [state, action] of this._acceptingStateActions.entries()) {
      serializedData.acceptingStateActions.push({
        stateIndex: this._stateList.indexOf(state),
        action: action,
      })
    }

    fs.writeFileSync(filePath, JSON.stringify(serializedData, null, 2))
  }

  /**
   * 从文件反序列化DFA
   * 兼容原项目的JSON格式（使用alphabet、startStatesIndex等字段）
   * @param filePath 文件路径
   * @returns 反序列化后的DFA
   */
  static deserialize(filePath: string): DeterministicAutomaton {
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const data: any = JSON.parse(fileContent)
    const automaton = new DeterministicAutomaton()

    // 恢复字母表（兼容原项目的alphabet字段）
    automaton._symbolSet = Array.from(data.symbolSet || data.alphabet || [])

    // 创建状态对象
    const stateCount = data.stateCount || data.stateCount || 0
    for (let i = 0; i < stateCount; i++) {
      automaton._stateList.push(new MachineState())
    }

    // 恢复初始状态（兼容原项目的startStatesIndex字段）
    const initialStateIndices = data.initialStateIndices || data.startStatesIndex || []
    for (const index of initialStateIndices) {
      automaton._initialStates.push(automaton._stateList[index])
    }

    // 恢复接受状态（兼容原项目的acceptStatesIndex字段）
    const acceptingStateIndices = data.acceptingStateIndices || data.acceptStatesIndex || []
    for (const index of acceptingStateIndices) {
      automaton._acceptingStates.push(automaton._stateList[index])
    }

    // 恢复状态转移表（兼容原项目的transformAdjList字段）
    // 原项目使用 {alpha, target} 格式，需要转换为 {inputSymbol, targetStateIndex} 格式
    const rawTransitionTable = data.transitionTable || data.transformAdjList || []
    automaton._transitionTable = rawTransitionTable.map((stateTransitions: any[]) => {
      if (!stateTransitions || stateTransitions.length === 0) {
        return []
      }
      // 检查是否是旧格式（使用 alpha 和 target）
      if (stateTransitions[0] && 'alpha' in stateTransitions[0] && 'target' in stateTransitions[0]) {
        return stateTransitions.map((t: any) => ({
          inputSymbol: t.alpha,
          targetStateIndex: t.target,
        }))
      }
      // 新格式，直接使用
      return stateTransitions
    })

    // 恢复接受状态动作映射（兼容原项目的acceptActionMap字段）
    const acceptingStateActions = data.acceptingStateActions || data.acceptActionMap || []
    for (const item of acceptingStateActions) {
      const stateIndex = item.stateIndex !== undefined ? item.stateIndex : item.accpetStateIndex
      const action = item.action
      if (stateIndex !== undefined && action) {
        automaton._acceptingStateActions.set(automaton._stateList[stateIndex], action)
      }
    }

    return automaton
  }
}

/**
 * DFA序列化数据格式
 */
export type DFASerializedData = {
  description: string
  symbolSet: string[]
  stateCount: number
  initialStateIndices: number[]
  acceptingStateIndices: number[]
  transitionTable: StateTransition[][]
  acceptingStateActions: Array<{
    stateIndex: number
    action: StateAction
  }>
}
