/**
 * 错误收集和报告模块
 */

import { CompilerError } from './utils'

/**
 * 错误类型
 */
export enum ErrorType {
  LexicalError = '词法错误',
  SyntaxError = '语法错误',
  SemanticError = '语义错误',
}

/**
 * 扩展的编译器错误类，包含行号和位置信息
 */
export class DetailedCompilerError extends CompilerError {
  public readonly errorType: ErrorType
  public readonly lineNumber: number
  public readonly position: number
  public readonly severity: 'error' | 'warning'

  constructor(
    errorType: ErrorType,
    message: string,
    lineNumber: number = 0,
    position: number = 0,
    severity: 'error' | 'warning' = 'error'
  ) {
    super(message)
    this.errorType = errorType
    this.lineNumber = lineNumber
    this.position = position
    this.severity = severity
    this.name = 'DetailedCompilerError'
  }
}

/**
 * 错误收集器类
 */
export class ErrorCollector {
  private _errors: DetailedCompilerError[] = []

  /**
   * 添加错误
   */
  addError(error: DetailedCompilerError): void {
    this._errors.push(error)
  }

  /**
   * 添加词法错误
   */
  addLexicalError(message: string, lineNumber: number = 0, position: number = 0): void {
    this.addError(new DetailedCompilerError(ErrorType.LexicalError, message, lineNumber, position, 'error'))
  }

  /**
   * 添加语法错误
   */
  addSyntaxError(message: string, lineNumber: number = 0, position: number = 0): void {
    this.addError(new DetailedCompilerError(ErrorType.SyntaxError, message, lineNumber, position, 'error'))
  }

  /**
   * 添加语义错误
   */
  addSemanticError(message: string, lineNumber: number = 0, position: number = 0): void {
    this.addError(new DetailedCompilerError(ErrorType.SemanticError, message, lineNumber, position, 'error'))
  }

  /**
   * 检查是否有错误
   */
  hasErrors(): boolean {
    return this._errors.length > 0
  }

  /**
   * 获取所有错误
   */
  getErrors(): DetailedCompilerError[] {
    return [...this._errors]
  }

  /**
   * 获取错误数量
   */
  getErrorCount(): number {
    return this._errors.length
  }

  /**
   * 报告所有错误
   */
  reportErrors(): void {
    if (this._errors.length === 0) {
      return
    }

    console.error(`\n[编译错误] 共发现 ${this._errors.length} 个错误：\n`)

    // 按行号排序
    const sortedErrors = [...this._errors].sort((a, b) => {
      if (a.lineNumber !== b.lineNumber) {
        return a.lineNumber - b.lineNumber
      }
      return a.position - b.position
    })

    for (const error of sortedErrors) {
      const location = error.lineNumber > 0 ? `行${error.lineNumber}` : ''
      const posInfo = error.position > 0 ? `，位置${error.position}` : ''
      console.error(`[${error.errorType}] ${error.message}${location ? `（${location}${posInfo}）` : ''}`)
    }

    console.error('')
  }

  /**
   * 清空所有错误
   */
  clear(): void {
    this._errors = []
  }
}
