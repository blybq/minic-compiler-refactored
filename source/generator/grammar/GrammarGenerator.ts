/**
 * 语法分析器生成器入口
 * 从.y文件生成LALR语法分析表的JSON文件
 */

import * as path from 'path'
import { GrammarFileParser } from './GrammarFileParser'
import { GrammarAnalyzer } from './GrammarAnalyzer'

/**
 * 从.y文件生成语法分析表JSON文件
 * @param grammarFilePath .y文件路径
 * @param outputPath 输出JSON文件路径（可选，默认为同目录下的{文件名}-LALRParse.json）
 */
export function generateGrammarTable(grammarFilePath: string, outputPath?: string): void {
  // 如果没有指定输出路径，使用默认路径
  if (!outputPath) {
    const baseName = path.basename(grammarFilePath, '.y')
    const dirName = path.dirname(grammarFilePath)
    outputPath = path.join(dirName, `${baseName}-LALRParse.json`)
  }

  // 确保输出目录存在
  const outputDir = path.dirname(outputPath)
  if (outputDir && outputDir !== '.') {
    const fs = require('fs')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
  }

  // 解析.y文件
  console.log(`[GrammarGenerator] 开始解析语法文件: ${grammarFilePath}`)
  const parser = new GrammarFileParser(grammarFilePath)
  console.log(`[GrammarGenerator] 语法文件解析完成，发现 ${parser.productionDefinitions.length} 个产生式`)

  // 构建LALR分析器
  const analyzer = new GrammarAnalyzer(parser)

  // 序列化
  const description = `从 ${grammarFilePath} 生成 @ ${new Date().toLocaleDateString()}`
  analyzer.serialize(description, outputPath)
}
