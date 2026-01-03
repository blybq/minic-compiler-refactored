/**
 * 有限状态自动机基础类型和类定义
 */

/**
 * 自动机状态
 */
export class MachineState {
  private readonly _identifier: symbol

  constructor(identifier?: symbol) {
    this._identifier = identifier || Symbol()
  }

  equals(other: MachineState): boolean {
    return this._identifier === other._identifier
  }

  static areEqual(state1: MachineState, state2: MachineState): boolean {
    return state1._identifier === state2._identifier
  }
}

/**
 * 状态转移动作
 */
export type StateAction = {
  order: number
  code: string
}

/**
 * 状态转移定义
 */
export type StateTransition = {
  inputSymbol: number // 输入符号在字母表中的索引，特殊值见SpecialSymbol枚举
  targetStateIndex: number // 目标状态在状态列表中的索引
}

/**
 * 特殊符号枚举
 */
export enum SpecialSymbol {
  EPSILON = -1, // ε（空字符）
  ANY_CHAR = -2, // . （除换行符外的任意字符）
  OTHER_CHAR = -3, // 其他未指定的字符
}

/**
 * 获取特殊符号的字符串表示
 */
export function getSpecialSymbolName(symbol: number): string {
  const symbolNames: { [key: string]: string } = { '-1': '[ε]', '-2': '[any]', '-3': '[other]' }
  return symbolNames[String(symbol)] || ''
}

/**
 * 有限状态自动机基类
 */
export class StateMachineBase {
  protected _symbolSet!: string[] // 字母表
  protected _stateList!: MachineState[] // 所有状态
  protected _initialStates!: MachineState[] // 初始状态
  protected _acceptingStates!: MachineState[] // 接受状态
  protected _transitionTable!: StateTransition[][] // 状态转移表

  get initialStates(): MachineState[] {
    return this._initialStates
  }

  get acceptingStates(): MachineState[] {
    return this._acceptingStates
  }

  get stateList(): MachineState[] {
    return this._stateList
  }

  get symbolSet(): string[] {
    return this._symbolSet
  }

  get transitionTable(): StateTransition[][] {
    return this._transitionTable
  }

  /**
   * 获取从指定状态出发的所有转移
   * @param state 起始状态
   * @param filterSymbols 如果提供，只返回这些符号的转移
   */
  protected getTransitionsFromState(state: MachineState, filterSymbols?: number[]): StateTransition[] {
    const transitions = this._transitionTable[this._stateList.indexOf(state)]
    if (filterSymbols) {
      return transitions.filter(t => filterSymbols.includes(t.inputSymbol))
    }
    return transitions
  }

  /**
   * 设置从指定状态出发的所有转移
   */
  protected setTransitionsFromState(state: MachineState, transitions: StateTransition[]): void {
    this._transitionTable[this._stateList.indexOf(state)] = transitions
  }

  /**
   * 深拷贝自动机，创建新的状态对象
   */
  static clone(machine: StateMachineBase): StateMachineBase {
    const cloned = new StateMachineBase()
    cloned._stateList = []
    cloned._initialStates = []
    cloned._acceptingStates = []
    for (let i = 0; i < machine._stateList.length; i++) {
      const originalState = machine._stateList[i]
      let newState: MachineState
      if (machine._initialStates.includes(originalState)) {
        newState = new MachineState()
        cloned._initialStates.push(newState)
        cloned._stateList[i] = newState
      } else if (machine._acceptingStates.includes(originalState)) {
        newState = new MachineState()
        cloned._acceptingStates.push(newState)
        cloned._stateList[i] = newState
      } else {
        newState = new MachineState()
        cloned._stateList[i] = newState
      }
    }
    cloned._symbolSet = [...machine._symbolSet]
    cloned._transitionTable = JSON.parse(JSON.stringify(machine._transitionTable))
    return cloned
  }
}

