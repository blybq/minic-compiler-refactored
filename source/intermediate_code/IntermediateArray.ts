/**
 * 中间代码阶段的数组信息
 */

import { DataType } from './DataTypes'

/**
 * 中间代码数组信息
 */
export class IntermediateArray {
  private _arrayId: string // 数组唯一标识符
  private _dataType: DataType // 数组元素类型
  private _arrayName: string // 数组名
  private _arrayLength: number // 数组长度
  private _scopePath: number[] // 作用域路径

  get arrayId(): string {
    return this._arrayId
  }

  set arrayId(value: string) {
    this._arrayId = value
  }

  get dataType(): DataType {
    return this._dataType
  }

  set dataType(value: DataType) {
    this._dataType = value
  }

  get arrayName(): string {
    return this._arrayName
  }

  set arrayName(value: string) {
    this._arrayName = value
  }

  get arrayLength(): number {
    return this._arrayLength
  }

  set arrayLength(value: number) {
    this._arrayLength = value
  }

  get scopePath(): number[] {
    return this._scopePath
  }

  set scopePath(value: number[]) {
    this._scopePath = value
  }

  constructor(arrayId: string, dataType: DataType, arrayName: string, arrayLength: number, scopePath: number[]) {
    this._arrayId = arrayId
    this._dataType = dataType
    this._arrayName = arrayName
    this._arrayLength = arrayLength
    this._scopePath = [...scopePath]
  }
}

