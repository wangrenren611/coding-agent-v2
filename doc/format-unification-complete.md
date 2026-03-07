# 跨平台格式统一配置完成

## 已完成的配置

### 1. Prettier 配置增强 (.prettierrc)
- ✅ **endOfLine: "lf"** - 统一使用 LF 换行符（跨平台标准）
- ✅ **useTabs: false** - 明确使用空格而非 Tab
- ✅ 添加了其他明确的格式化选项，避免不同平台的默认值差异

### 2. EditorConfig 配置 (.editorconfig) ✨新增
- ✅ 统一文件编码为 UTF-8
- ✅ 统一换行符为 LF
- ✅ 统一缩进风格（2 空格）
- ✅ 确保文件末尾有换行符
- ✅ 自动删除行尾空白字符

### 3. Prettier Ignore 配置 (.prettierignore) ✨新增
- ✅ 排除不需要格式化的文件和目录
- ✅ 包括 node_modules、dist、日志文件等

### 4. Lint-staged 配置 ✨新增
- ✅ 在 Git 提交前自动格式化代码
- ✅ 只处理暂存的文件，提高效率
- ✅ 同时运行 Prettier 和 ESLint

### 5. Package.json 更新
- ✅ 添加 lint-staged 依赖
- ✅ 扩展 format 脚本，包含更多文件类型
- ✅ 添加 lint-staged 配置

## 已格式化的文件

运行 `pnpm format` 后，所有源代码文件已统一格式：
- 📝 所有 TypeScript 源文件（src/**/*.ts）
- 📝 所有示例文件（examples/**/*.ts）
- 📝 配置文件（package.json, tsconfig.json）

**主要变更**：换行符从 CRLF 统一为 LF，确保跨平台一致性。

## 下一步建议

### 1. 安装 EditorConfig 插件（推荐）
如果你使用 VS Code，请安装 `EditorConfig for VS Code` 插件，其他 IDE 也有相应插件。

### 2. 配置 Git（推荐）
```bash
# 禁止 Git 自动转换换行符
git config --global core.autocrlf false
```

### 3. 提交变更
建议分两次提交：

#### 第一次提交：配置文件
```bash
git add .prettierrc .editorconfig .prettierignore .lintstagedrc package.json pnpm-lock.yaml
git commit -m "chore: 统一跨平台格式化配置

- 增强 Prettier 配置，明确指定 endOfLine 为 lf
- 添加 EditorConfig 配置，统一编辑器行为
- 添加 Prettier ignore 配置
- 添加 lint-staged 配置，提交前自动格式化
- 更新 format 脚本，包含更多文件类型
"
```

#### 第二次提交：格式化后的代码
```bash
git add .
git commit -m "style: 统一所有代码文件的格式

- 统一换行符为 LF
- 运行 prettier format 统一所有代码格式
"
```

### 4. 团队协作
确保所有团队成员：
1. 安装 EditorConfig 插件
2. 安装 Prettier 插件
3. 配置 Git `core.autocrlf false`
4. 运行 `pnpm install` 安装 lint-staged

## 使用方法

### 格式化所有代码
```bash
pnpm format
```

### 检查代码格式（CI 中使用）
```bash
pnpm format:check
```

### 提交前自动格式化
配置已集成到 Git hooks，提交时会自动：
1. 格式化暂存的文件
2. 运行 ESLint 修复
3. 运行类型检查
4. 运行测试

## 常见问题

**Q: 为什么选择 LF 而不是 CRLF？**
A: LF 是 Unix/Linux/macOS 的标准，也是跨平台项目的最佳实践。现代 Windows 工具（包括 Node.js、Git、VS Code）都完全支持 LF。

**Q: 为什么这么多文件都变了？**
A: 主要是换行符统一导致的。虽然看起来改动很大，但实际只是换行符的变化，代码逻辑没有改变。

**Q: 如何查看文件的换行符？**
A: 在 VS Code 右下角状态栏可以看到（LF 或 CRLF），点击可以切换。

**Q: 提交前检查失败怎么办？**
A: 运行 `pnpm format` 重新格式化，然后再提交即可。

## 配置文件说明

- **.prettierrc** - Prettier 格式化配置
- **.editorconfig** - 编辑器配置，确保不同 IDE 行为一致
- **.prettierignore** - Prettier 忽略文件
- **.lintstagedrc** - lint-staged 配置（Git hooks）
- **package.json** - 包含 lint-staged 配置和格式化脚本

## 参考资源

- [Prettier 文档](https://prettier.io/)
- [EditorConfig 文档](https://editorconfig.org/)
- [lint-staged 文档](https://github.com/okonet/lint-staged)
