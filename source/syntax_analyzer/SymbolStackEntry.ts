/**
 * 符号栈元素定义
 */

import { SyntaxTreeNode } from '../intermediate/SyntaxTreeNode'

/**
 * 符号栈元素
 */
export interface SymbolStackEntry {
  /** 元素类型：token或nonterminal */
  elementType: 'token' | 'nonterminal'
  /** 符号名称 */
  symbolName: string
  /** 对应的语法树节点 */
  syntaxNode: SyntaxTreeNode
}

/**
 * 创建非终结符节点（用于语义动作执行）
 * @param nodeName 节点名称
 * @param entries 符号栈元素列表
 * @returns 符号栈元素
 */
export function createNonterminalNode(nodeName: string, ...entries: SymbolStackEntry[]): SymbolStackEntry {
  const node = new SyntaxTreeNode(nodeName, 'nonterminal', nodeName)
  const childNodes = entries.map(entry => entry.syntaxNode)
  for (const childNode of childNodes) {
    node.appendChild(childNode)
  }
  return {
    elementType: 'nonterminal',
    symbolName: nodeName,
    syntaxNode: node,
  }
}

