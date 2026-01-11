/**
 * 语法树节点定义
 */

import { requireCondition } from '../core/utils'

/**
 * 语法树节点
 */
export class SyntaxTreeNode {
  private _nodeName: string // 节点名称
  private _nodeType: 'token' | 'nonterminal' // 节点类型：Token（终结符）节点 / 非终结符节点
  private _literalValue: string // 字面量，非终结符的字面量没有意义
  private _childNodes: SyntaxTreeNode[] // 子节点
  private _lineNumber: number // 行号（从1开始，0表示未知）

  get nodeName(): string {
    return this._nodeName
  }

  set nodeName(value: string) {
    this._nodeName = value
  }

  get nodeType(): 'token' | 'nonterminal' {
    return this._nodeType
  }

  set nodeType(value: 'token' | 'nonterminal') {
    this._nodeType = value
  }

  get literalValue(): string {
    return this._literalValue
  }

  set literalValue(value: string) {
    this._literalValue = value
  }

  get childNodes(): SyntaxTreeNode[] {
    return this._childNodes
  }

  set childNodes(value: SyntaxTreeNode[]) {
    this._childNodes = Array.from(value)
  }

  get lineNumber(): number {
    return this._lineNumber
  }

  set lineNumber(value: number) {
    this._lineNumber = value
  }

  constructor(nodeName: string, nodeType: 'token' | 'nonterminal', literalValue: string, lineNumber: number = 0) {
    this._nodeName = nodeName
    this._nodeType = nodeType
    this._literalValue = literalValue
    this._childNodes = []
    this._lineNumber = lineNumber
  }

  /**
   * 添加子节点
   */
  appendChild(node: SyntaxTreeNode): void {
    this._childNodes.push(node)
  }

  /**
   * 判断子节点名称序列是否匹配给定的序列
   * @param sequence 要匹配的节点名称序列（空格分隔）
   */
  matchesSequence(sequence: string): boolean {
    const nameSequence = sequence.trim().split(' ')
    if (nameSequence.length !== this._childNodes.length) {
      return false
    }
    for (let i = 0; i < nameSequence.length; i++) {
      if (nameSequence[i] !== this._childNodes[i]._nodeName) {
        return false
      }
    }
    return true
  }

  /**
   * 获取第i个子节点（从1开始索引）
   * @param index 子节点索引（从1开始）
   */
  getChild(index: number): SyntaxTreeNode {
    requireCondition(
      index > 0 && index <= this._childNodes.length,
      `子节点索引超出范围：${index}，共有${this._childNodes.length}个子节点`
    )
    return this._childNodes[index - 1]
  }
}

