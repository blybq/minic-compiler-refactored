/**
 * 中间代码阶段的函数信息
 */

import { DataType } from './DataTypes'
import { IntermediateVariable } from './IntermediateVariable'
import { IntermediateArray } from './IntermediateArray'

/**
 * 中间代码函数信息
 */
export class IntermediateFunction {
  private _functionName: string // 函数名
  private _returnType: DataType // 函数返回值类型
  private _entryLabel: string // 入口标签
  private _exitLabel: string // 出口标签
  private _hasReturnStatement: boolean // 内部是否有return语句
  private _parameterList: (IntermediateVariable | IntermediateArray)[] // 形参列表（支持数组参数）
  private _localVariables: (IntermediateVariable | IntermediateArray)[] // 所有局部变量
  private _childFunctions: string[] // 内部调用过的其他函数
  private _scopePath: number[] // 基础作用域路径
  private _isInterruptFunction: boolean // 是否为中断函数（interruptServer0-4）

  get functionName(): string {
    return this._functionName
  }

  set functionName(value: string) {
    this._functionName = value
  }

  get returnType(): DataType {
    return this._returnType
  }

  set returnType(value: DataType) {
    this._returnType = value
  }

  get entryLabel(): string {
    return this._entryLabel
  }

  set entryLabel(value: string) {
    this._entryLabel = value
  }

  get exitLabel(): string {
    return this._exitLabel
  }

  set exitLabel(value: string) {
    this._exitLabel = value
  }

  get hasReturnStatement(): boolean {
    return this._hasReturnStatement
  }

  set hasReturnStatement(value: boolean) {
    this._hasReturnStatement = value
  }

  get parameterList(): (IntermediateVariable | IntermediateArray)[] {
    return this._parameterList
  }

  set parameterList(value: (IntermediateVariable | IntermediateArray)[]) {
    this._parameterList = value
  }

  get localVariables(): (IntermediateVariable | IntermediateArray)[] {
    return this._localVariables
  }

  set localVariables(value: (IntermediateVariable | IntermediateArray)[]) {
    this._localVariables = value
  }

  get childFunctions(): string[] {
    return this._childFunctions
  }

  set childFunctions(value: string[]) {
    this._childFunctions = value
  }

  get scopePath(): number[] {
    return this._scopePath
  }

  set scopePath(value: number[]) {
    this._scopePath = value
  }

  constructor(
    functionName: string,
    returnType: DataType,
    parameterList: (IntermediateVariable | IntermediateArray)[],
    entryLabel: string,
    exitLabel: string,
    scopePath: number[],
    hasReturnStatement: boolean = false,
    isInterruptFunction: boolean = false
  ) {
    this._functionName = functionName
    this._returnType = returnType
    this._parameterList = parameterList
    this._entryLabel = entryLabel
    this._exitLabel = exitLabel
    this._scopePath = [...scopePath]
    this._hasReturnStatement = hasReturnStatement
    this._localVariables = []
    this._childFunctions = []
    this._isInterruptFunction = isInterruptFunction
  }

  get isInterruptFunction(): boolean {
    return this._isInterruptFunction
  }

  set isInterruptFunction(value: boolean) {
    this._isInterruptFunction = value
  }
}

