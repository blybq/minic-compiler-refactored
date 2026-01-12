/**
 * 中断处理程序生成器
 * 生成中断向量表和处理程序文件
 */

import { IntermediateCodeGenerator } from '../intermediate_code/IntermediateCodeGenerator'
import { IntermediateFunction } from '../intermediate_code/IntermediateFunction'
import { AssemblyCodeGenerator } from './AssemblyCodeGenerator'

/**
 * 生成中断向量表文件内容
 * @param interruptFunctions 中断函数列表（按interruptServer0-4排序）
 */
export function generateInterruptEntry(interruptFunctions: IntermediateFunction[]): string {
  const lines: string[] = []
  lines.push('# minisys-interrupt-entry.asm')
  lines.push('')
  
  // 按interruptServer0-4的顺序生成j指令
  for (let i = 0; i < 5; i++) {
    const funcName = `interruptServer${i}`
    const func = interruptFunctions.find(f => f.functionName === funcName)
    if (func) {
      lines.push(`j ${funcName}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * 生成中断处理程序文件内容
 * @param interruptFunctions 中断函数列表
 * @param functionBodyAsm 函数体汇编代码映射（函数名 -> 汇编代码行数组）
 */
export function generateInterruptHandler(
  interruptFunctions: IntermediateFunction[],
  functionBodyAsm: Map<string, string[]>
): string {
  const lines: string[] = []
  lines.push('# minisys-interrupt-handler.asm')
  lines.push('')
  
  // 为每个中断函数生成处理程序
  for (const func of interruptFunctions.sort((a, b) => {
    // 按interruptServer0-4排序
    const aNum = parseInt(a.functionName.replace('interruptServer', ''))
    const bNum = parseInt(b.functionName.replace('interruptServer', ''))
    return aNum - bNum
  })) {
    lines.push(`${func.functionName}:`)
    
    // 获取函数体汇编代码
    const funcBodyAsm = functionBodyAsm.get(func.functionName) || []
    
    // 分析函数体中使用的寄存器
    const usedRegisters = new Set<string>()
    for (const line of funcBodyAsm) {
      // 匹配寄存器：$t0-$t9, $s0-$s7, $v0-$v1, $a0-$a3, $ra, $sp等
      const regMatches = line.match(/\$[tsvra][0-9]|\$sp|\$ra/g)
      if (regMatches) {
        for (const reg of regMatches) {
          // 排除$sp（栈指针不需要保护）
          if (reg !== '$sp') {
            usedRegisters.add(reg)
          }
        }
      }
    }
    
    // 根据MIPS调用约定，确定需要保护的寄存器
    // 中断处理程序需要保护：$s0-$s7（被调用者保存寄存器）、$t0-$t9（临时寄存器）和$ra（返回地址）
    const registersToSave: string[] = []
    
    // 添加$s0-$s7（如果函数体中使用了）
    for (let i = 0; i <= 7; i++) {
      const reg = `$s${i}`
      if (usedRegisters.has(reg)) {
        registersToSave.push(reg)
      }
    }
    
    // 添加$t0-$t9（如果函数体中使用了）
    for (let i = 0; i <= 9; i++) {
      const reg = `$t${i}`
      if (usedRegisters.has(reg)) {
        registersToSave.push(reg)
      }
    }
    
    // 添加$ra（如果函数体中使用了）
    if (usedRegisters.has('$ra')) {
      registersToSave.push('$ra')
    }
    
    // 按标准顺序排序：$s0-$s7, $t0-$t9, $ra
    registersToSave.sort((a, b) => {
      const order: string[] = []
      // $s0-$s7
      for (let i = 0; i <= 7; i++) {
        order.push(`$s${i}`)
      }
      // $t0-$t9
      for (let i = 0; i <= 9; i++) {
        order.push(`$t${i}`)
      }
      // $ra
      order.push('$ra')
      return order.indexOf(a) - order.indexOf(b)
    })
    
    // 生成push指令（保护寄存器）
    for (const reg of registersToSave) {
      lines.push(`\tpush ${reg}`)
    }
    
    // 插入函数体代码
    if (funcBodyAsm.length > 0) {
      for (const line of funcBodyAsm) {
        lines.push(line)
      }
    } else {
      lines.push('\t# 编译自 C 的主体代码')
      lines.push(`\t# 函数: ${func.functionName}`)
    }
    
    // 生成pop指令（恢复寄存器，顺序相反）
    for (let i = registersToSave.length - 1; i >= 0; i--) {
      lines.push(`\tpop ${registersToSave[i]}`)
    }
    
    // 返回中断
    lines.push('\teret')
    lines.push('\tnop')
    lines.push('')
  }
  
  return lines.join('\n')
}

/**
 * 从AssemblyCodeGenerator中提取指定函数的汇编代码
 * @param asmGen 汇编代码生成器
 * @param func 函数对象
 * @param allAsm 所有汇编代码行
 */
export function extractFunctionAsm(
  asmGen: AssemblyCodeGenerator,
  func: IntermediateFunction,
  allAsm: string[]
): string[] {
  const funcAsm: string[] = []
  let inFunction = false
  let skipCount = 0 // 跳过栈帧分配的行数
  
  for (const line of allAsm) {
    const trimmedLine = line.trim()
    
    // 检查是否是函数入口标签（可能是带注释的标签行）
    if (trimmedLine.includes(`${func.functionName}:`)) {
      inFunction = true
      skipCount = 0 // 重置跳过计数
      continue // 跳过函数标签，因为我们会在中断处理程序中重新定义
    }
    
    if (inFunction) {
      // 跳过栈帧分配的第一行（addiu $sp, $sp, -xxx）
      if (skipCount === 0 && trimmedLine.match(/^\s*addiu\s+\$sp,\s+\$sp,\s+-/)) {
        skipCount++
        continue
      }
      
      // 跳过返回地址保存（sw $ra, ...）
      if (trimmedLine.match(/^\s*sw\s+\$ra,/)) {
        continue
      }
      
      // 跳过寄存器保存（sw $sX, ...）
      if (trimmedLine.match(/^\s*sw\s+\$s\d+,/)) {
        continue
      }
      
      // 检查是否是另一个函数的入口（不以_label_开头的标签，且不是当前函数）
      // 注意：标签行可能是 "funcName:\t\t# comment" 格式
      if (trimmedLine.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/) && 
          !trimmedLine.startsWith('_label_') && 
          !trimmedLine.includes(func.functionName) &&
          !trimmedLine.startsWith('#')) {
        // 提取标签名（冒号前的部分）
        const labelMatch = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)
        if (labelMatch && labelMatch[1] !== func.functionName) {
          // 遇到另一个函数，结束当前函数
          break
        }
      }
      
      // 检查是否是返回指令（jr $ra或跳转到exit标签）
      if (trimmedLine.match(/^\s*jr\s+\$ra/) || 
          (trimmedLine.match(/^\s*j\s+/) && trimmedLine.includes('_exit'))) {
        // 跳过返回指令，因为中断处理程序使用iret
        break
      }
      
      // 跳过寄存器恢复（lw $sX, ...）
      if (trimmedLine.match(/^\s*lw\s+\$s\d+,/)) {
        continue
      }
      
      // 跳过返回地址恢复（lw $ra, ...）
      if (trimmedLine.match(/^\s*lw\s+\$ra,/)) {
        continue
      }
      
      // 跳过栈帧恢复（addiu $sp, $sp, +xxx）
      if (trimmedLine.match(/^\s*addiu\s+\$sp,\s+\$sp,\s+\+/)) {
        continue
      }
      
      // 跳过函数注释行（包含"vars =", "regs to save"等）
      if (trimmedLine.startsWith('# vars =') || 
          trimmedLine.startsWith('# regs to save') ||
          trimmedLine.startsWith('# outgoing args') ||
          trimmedLine.startsWith('# need to save') ||
          trimmedLine.startsWith('# do not need')) {
        continue
      }
      
      // 跳过函数退出标签（包含_exit的标签）
      if (trimmedLine.match(/_exit:/)) {
        break
      }
      
      // 添加函数体指令
      funcAsm.push(line)
    }
  }
  
  return funcAsm
}
