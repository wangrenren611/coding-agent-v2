# Prettier 配置说明

## 跨平台统一格式配置

为了确保在不同操作系统（Windows/Linux/macOS）上代码格式保持一致，我们做了以下配置：

### 1. Prettier 配置 (.prettierrc)

关键配置项：
- **endOfLine: "lf"** - 统一使用 LF 换行符（推荐跨平台使用）
- **useTabs: false** - 使用空格而非 Tab（更可靠）
- **tabWidth: 2** - 缩进宽度 2 空格
- **其他配置** - 明确指定所有格式化选项，避免默认值差异

### 2. EditorConfig (.editorconfig)

确保不同编辑器和 IDE 使用相同的配置：
- **charset: utf-8** - 统一文件编码
- **end_of_line: lf** - 统一换行符
- **insert_final_newline: true** - 文件末尾插入空行
- **trim_trailing_whitespace: true** - 删除行尾空白

### 3. Prettier Ignore (.prettierignore)

排除不需要格式化的文件和目录。

## 使用方法

### 格式化所有代码
\`\`\`bash
pnpm format
\`\`\`

### 检查格式（CI 中使用）
\`\`\`bash
pnpm format:check
\`\`\`

### Git 提交前自动格式化

项目已配置 Husky，提交前会自动执行格式检查。

## 注意事项

1. **换行符问题**：
   - Windows 默认使用 CRLF，Linux/macOS 使用 LF
   - 配置强制使用 LF，确保跨平台一致性
   - Git 配置建议：`git config --global core.autocrlf false`

2. **编辑器配置**：
   - VS Code 需安装 EditorConfig 插件
   - 其他 IDE 也建议安装相应插件支持

3. **现有代码**：
   - 运行 `pnpm format` 统一格式化所有现有代码
   - 可能会产生大量文件变更（主要是换行符）

## 常见问题

**Q: 为什么选择 LF 而不是 CRLF？**
A: LF 是 Unix/Linux/macOS 的标准，也是跨平台项目的最佳实践。现代 Windows 工具都支持 LF。

**Q: 如何查看文件的换行符？**
A: 在 VS Code 右下角状态栏可以看到（LF 或 CRLF），点击可以切换。

**Q: 格式化后 Git 显示整个文件都变了？**
A: 这通常是因为换行符统一导致的。建议在一个单独的提交中统一处理格式化。
