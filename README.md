# MiniC Compiler

MiniC语言编译器，用于将MiniC源代码编译为Minisys系统（类MIPS架构）的汇编代码。

## 编译流程

1. 预处理：处理include指令
2. 词法分析：将源代码转换为Token序列
3. 语法分析：基于LALR分析表进行语法分析，生成AST
4. 中间代码生成：从AST生成中间代码表示
5. 代码优化：对中间代码进行优化
6. 目标代码生成：将中间代码转换为汇编代码

## 使用方法

```bash
npm install
npm run compile
node build/main.js <source_file> [options]
```

可用选项：
- `-o <output_path>` 指定输出路径
- `-i` 同时输出中间代码
- `-v` 显示详细编译过程

## 项目结构

- `source/` 源代码目录
- `test/` 测试代码目录
- `docs/` 文档目录
- `syntax/` 语法定义文件目录

