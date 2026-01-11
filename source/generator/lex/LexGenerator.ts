/**
 * 词法分析器生成器入口
 * 从.l文件生成词法分析DFA的JSON文件
 */

import * as path from 'path'
import { AutomatonBuilder } from './AutomatonBuilder'

/**
 * 从.l文件生成词法分析表JSON文件
 * @param lexFilePath .l文件路径
 * @param outputPath 输出JSON文件路径（可选，默认为同目录下的{文件名}-Lex.json）
 */
export function generateLexTable(lexFilePath: string, outputPath?: string): void {
  // 如果没有指定输出路径，使用默认路径
  if (!outputPath) {
    const baseName = path.basename(lexFilePath, '.l')
    const dirName = path.dirname(lexFilePath)
    outputPath = path.join(dirName, `${baseName}-Lex.json`)
  }

  // 确保输出目录存在
  const outputDir = path.dirname(outputPath)
  if (outputDir && outputDir !== '.') {
    const fs = require('fs')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
  }

  // 构建并序列化
  AutomatonBuilder.buildAndSerialize(lexFilePath, outputPath)
}
