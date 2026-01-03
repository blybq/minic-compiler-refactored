/**
 * 中间代码阶段的变量信息
 */

import { DataType } from './DataTypes'

/**
 * 中间代码变量信息
 */
export class IntermediateVariable {
  private _variableId: string // 变量唯一标识符
  private _variableName: string // 变量名
  private _dataType: DataType // 变量类型
  private _scopePath: number[] // 作用域路径
  private _isInitialized: boolean // 是否已初始化

  get variableId(): string {
    return this._variableId
  }

  set variableId(value: string) {
    this._variableId = value
  }

  get variableName(): string {
    return this._variableName
  }

  set variableName(value: string) {
    this._variableName = value
  }

  get dataType(): DataType {
    return this._dataType
  }

  set dataType(value: DataType) {
    this._dataType = value
  }

  get scopePath(): number[] {
    return this._scopePath
  }

  set scopePath(value: number[]) {
    this._scopePath = value
  }

  get isInitialized(): boolean {
    return this._isInitialized
  }

  set isInitialized(value: boolean) {
    this._isInitialized = value
  }

  constructor(
    variableId: string,
    variableName: string,
    dataType: DataType,
    scopePath: number[],
    isInitialized: boolean
  ) {
    this._variableId = variableId
    this._variableName = variableName
    this._dataType = dataType
    this._scopePath = [...scopePath]
    this._isInitialized = isInitialized
  }
}

