/**
 * 中间代码指令（四元式）定义
 */

/**
 * 四元式：(op, arg1, arg2, res)
 */
export class InstructionQuad {
  private _operation: string // 操作符
  private _operand1: string // 第一个操作数
  private _operand2: string // 第二个操作数
  private _result: string // 结果

  get operation(): string {
    return this._operation
  }

  set operation(value: string) {
    this._operation = value
  }

  get operand1(): string {
    return this._operand1
  }

  set operand1(value: string) {
    this._operand1 = value
  }

  get operand2(): string {
    return this._operand2
  }

  set operand2(value: string) {
    this._operand2 = value
  }

  get result(): string {
    return this._result
  }

  set result(value: string) {
    this._result = value
  }

  constructor(operation: string, operand1: string, operand2: string, result: string) {
    this._operation = operation
    this._operand1 = operand1
    this._operand2 = operand2
    this._result = result
  }

  /**
   * 将四元式转换为字符串表示
   * @param paddingLength 每个字段的填充长度
   */
  toString(paddingLength: number = 12): string {
    const padEnd = paddingLength
    return `(${this._operation.padEnd(padEnd)}, ${this._operand1.padEnd(padEnd)}, ${this._operand2.padEnd(padEnd)}, ${this._result.padEnd(padEnd !== 0 ? padEnd + 8 : 0)})`
  }
}

