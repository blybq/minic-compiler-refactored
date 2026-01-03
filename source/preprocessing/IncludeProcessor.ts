/**
 * 预编译模块：处理include指令
 */

import * as fs from 'fs'
import * as path from 'path'
import { requireCondition, CompilerError } from '../core/utils'

/**
 * 处理源代码中的include指令
 * @param sourceCode 原始源代码
 * @param baseDirectory 基础目录路径，用于解析相对路径
 * @returns 处理后的源代码
 */
export function processIncludeDirectives(sourceCode: string, baseDirectory: string): string {
  const lines = sourceCode
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())

  const includeReplacements: Array<{ lineIndex: number; filePath: string; fileContent: string[] }> = []

  const includePattern = /^#include\s+"(.*?)"$/
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 如果遇到非空行且不是注释且不是include指令，停止处理
    if (line && !line.startsWith('//') && !line.match(includePattern)) {
      break
    }
    // 跳过空行和注释
    if (!line || line.startsWith('//')) {
      continue
    }
    const matchResult = line.match(includePattern)
    if (!matchResult) {
      continue
    }
    const relativeFilePath = matchResult[1]
    const absoluteFilePath = path.resolve(baseDirectory, relativeFilePath)
    requireCondition(fs.existsSync(absoluteFilePath), `无法找到被include的文件：${relativeFilePath}`)
    const fileStat = fs.statSync(absoluteFilePath)
    requireCondition(fileStat.isFile(), `无法找到被include的文件：${relativeFilePath}`)
    const fileContent = fs.readFileSync(absoluteFilePath).toString('utf-8')
    const fileLines = fileContent.replace(/\r\n/g, '\n').split('\n')
    includeReplacements.push({
      lineIndex: i,
      filePath: relativeFilePath,
      fileContent: fileLines,
    })
  }

  // 应用include替换
  let lineOffset = 0
  for (const replacement of includeReplacements) {
    const insertionLines = [
      `// ===== ${replacement.filePath} =====`,
      ...replacement.fileContent,
      `// ===== ${replacement.filePath} =====`,
      '',
    ]
    lines.splice(replacement.lineIndex + lineOffset, 1, ...insertionLines)
    lineOffset += insertionLines.length - 1
  }

  return lines.join('\n')
}

