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
  
  // 按interruptServer0-4的顺序生成jmp指令
  for (let i = 0; i < 5; i++) {
    const funcName = `interruptServer${i}`
    const func = interruptFunctions.find(f => f.functionName === funcName)
    if (func) {
      lines.push(`jmp ${funcName}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * 生成中断处理程序文件内容
 * @param ir 中间代码生成器
 * @param interruptFunctions 中断函数列表
 */
export function generateInterruptHandler(
  ir: IntermediateCodeGenerator,
  interruptFunctions: IntermediateFunction[]
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
    
    // 保存寄存器（push r1, r2, r3, ...）
    // 使用$t0-$t9和$s0-$s7，但根据实际需要保存
    // 这里先保存常用的寄存器
    const registersToSave = ['$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7', '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7', '$t8', '$t9']
    
    // 先保存所有寄存器到栈
    for (const reg of registersToSave) {
      lines.push(`\tpush ${reg}`)
    }
    
    // 生成函数体代码
    // 需要从主汇编代码中提取该函数的代码
    // 这里我们需要访问AssemblyCodeGenerator来获取函数的汇编代码
    // 但为了避免循环依赖，我们传入一个函数来获取汇编代码
    
    // 暂时使用占位符，后续需要从AssemblyCodeGenerator中提取
    lines.push('\t# 编译自 C 的主体代码')
    lines.push(`\t# 函数: ${func.functionName}`)
    lines.push('\t# TODO: 插入函数主体汇编代码')
    
    // 恢复寄存器（pop r3, r2, r1, ...，顺序相反）
    for (let i = registersToSave.length - 1; i >= 0; i--) {
      lines.push(`\tpop ${registersToSave[i]}`)
    }
    
    // 返回中断
    lines.push('\tiret')
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
