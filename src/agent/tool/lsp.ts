import { z } from 'zod';
import * as ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { BaseTool, type ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { ensurePathWithinAllowed, normalizeAllowedDirectories } from './path-security';
import { LSP_TOOL_DESCRIPTION } from './tool-prompts';
import type { ToolExecutionContext } from './types';

// 支持的操作类型
const OPERATIONS = ['goToDefinition', 'findReferences', 'hover', 'documentSymbols'] as const;

/**
 * 创建 TypeScript 语言服务
 * 每次调用创建新实例以确保文件列表是最新的
 */
function createLanguageService(filePath: string): ts.LanguageService {
  const configPath = findTsConfig(filePath);
  const { options, fileNames } = loadCompilerOptions(configPath);
  // 确保目标文件在文件列表中
  const resolvedPath = path.resolve(filePath);
  const allFileNames = fileNames.includes(resolvedPath) ? fileNames : [...fileNames, resolvedPath];
  const host = createServiceHost(options, allFileNames);
  return ts.createLanguageService(host);
}

/**
 * 查找最近的 tsconfig.json
 */
function findTsConfig(startPath: string): string | undefined {
  let dir = path.dirname(path.resolve(startPath));
  const root = path.parse(dir).root;

  while (dir !== root) {
    const configPath = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

/**
 * 加载编译器选项
 */
function loadCompilerOptions(configPath?: string): {
  options: ts.CompilerOptions;
  fileNames: string[];
} {
  if (configPath) {
    const configText = fs.readFileSync(configPath, 'utf-8');
    const result = ts.parseConfigFileTextToJson(configPath, configText);
    if (result.error) {
      return getDefaultOptions();
    }
    const parsed = ts.parseJsonConfigFileContent(result.config, ts.sys, path.dirname(configPath));
    return { options: parsed.options, fileNames: parsed.fileNames };
  }
  return getDefaultOptions();
}

function getDefaultOptions(): { options: ts.CompilerOptions; fileNames: string[] } {
  return {
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      checkJs: false,
      strict: false,
      skipLibCheck: true,
      noEmit: true,
    },
    fileNames: [],
  };
}

/**
 * 创建语言服务宿主
 */
function createServiceHost(
  options: ts.CompilerOptions,
  fileNames: string[]
): ts.LanguageServiceHost {
  const files = new Map<string, { version: number; content: string }>();
  const knownFileNames = new Set<string>();

  // 预加载已知文件
  for (const fileName of fileNames) {
    try {
      const resolved = path.resolve(fileName);
      const content = fs.readFileSync(resolved, 'utf-8');
      files.set(resolved, { version: 0, content });
      knownFileNames.add(resolved);
    } catch {
      // 忽略读取失败的文件
    }
  }

  function ensureFileLoaded(fileName: string): void {
    const resolved = path.resolve(fileName);
    if (!files.has(resolved)) {
      try {
        const content = fs.readFileSync(resolved, 'utf-8');
        files.set(resolved, { version: 0, content });
        knownFileNames.add(resolved);
      } catch {
        // 文件不存在或无法读取
      }
    }
  }

  return {
    getScriptFileNames: () => Array.from(knownFileNames),
    getScriptVersion: (fileName) => {
      ensureFileLoaded(fileName);
      const file = files.get(path.resolve(fileName));
      return file ? String(file.version) : '0';
    },
    getScriptSnapshot: (fileName) => {
      ensureFileLoaded(fileName);
      const resolved = path.resolve(fileName);
      const file = files.get(resolved);
      if (!file) {
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(file.content);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => options,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (fileName) => fs.existsSync(fileName),
    readFile: (fileName) => {
      try {
        return fs.readFileSync(fileName, 'utf-8');
      } catch {
        return undefined;
      }
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
}

/**
 * 将行/列转换为文件偏移位置
 */
function getPositionFromLineCharacter(
  service: ts.LanguageService,
  fileName: string,
  line: number,
  character: number
): number {
  const sourceFile = service.getProgram()?.getSourceFile(fileName);
  if (!sourceFile) {
    return 0;
  }
  return sourceFile.getPositionOfLineAndCharacter(line - 1, character - 1);
}

/**
 * 格式化位置信息
 */
function formatLocation(fileName: string, line: number, character: number): string {
  return `${fileName}:${line + 1}:${character + 1}`;
}

/**
 * 获取行和列偏移（兼容不同 TypeScript 版本）
 */
function getLineAndCharacter(
  service: ts.LanguageService,
  fileName: string,
  position: number
): { line: number; character: number } {
  // TypeScript 5.5+ 提供 toLineColumnOffset
  if (typeof service.toLineColumnOffset === 'function') {
    return service.toLineColumnOffset(fileName, position);
  }
  // 回退：使用 ScriptSnapshot 计算
  const snapshot = service.getProgram()?.getSourceFile(fileName);
  if (snapshot) {
    const pos = ts.getLineAndCharacterOfPosition(snapshot, position);
    return { line: pos.line, character: pos.character };
  }
  return { line: 0, character: 0 };
}

/**
 * 执行 goToDefinition 操作
 */
function executeGoToDefinition(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolResult {
  const position = getPositionFromLineCharacter(service, filePath, line, character);
  const definition = service.getDefinitionAndBoundSpan(filePath, position);

  if (!definition || !definition.definitions || definition.definitions.length === 0) {
    return {
      success: true,
      output: 'No definition found',
      metadata: { found: false },
    };
  }

  const lines: string[] = [`Found ${definition.definitions.length} definition(s):\n`];
  for (const def of definition.definitions) {
    const start = getLineAndCharacter(service, def.fileName, def.textSpan.start);
    lines.push(`  ${formatLocation(def.fileName, start.line, start.character)}`);
    if (def.kind) {
      lines.push(`    Kind: ${def.kind}`);
    }
    if (def.containerName) {
      lines.push(`    Container: ${def.containerName}`);
    }
  }

  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      found: true,
      definitions: definition.definitions.map((d) => ({
        fileName: d.fileName,
        start: d.textSpan.start,
        length: d.textSpan.length,
        kind: d.kind,
        name: d.name,
        containerName: d.containerName,
      })),
    },
  };
}

/**
 * 执行 findReferences 操作
 */
function executeFindReferences(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolResult {
  const position = getPositionFromLineCharacter(service, filePath, line, character);
  const references = service.getReferencesAtPosition(filePath, position);

  if (!references || references.length === 0) {
    return {
      success: true,
      output: 'No references found',
      metadata: { found: false },
    };
  }

  const lines: string[] = [`Found ${references.length} reference(s):\n`];
  for (const ref of references) {
    const start = getLineAndCharacter(service, ref.fileName, ref.textSpan.start);
    const isWrite = ref.isWriteAccess ? ' (write)' : ' (read)';
    lines.push(`  ${formatLocation(ref.fileName, start.line, start.character)}${isWrite}`);
  }

  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      found: true,
      count: references.length,
      references: references.map((r) => ({
        fileName: r.fileName,
        start: r.textSpan.start,
        length: r.textSpan.length,
        isWrite: r.isWriteAccess,
      })),
    },
  };
}

/**
 * 执行 hover 操作
 */
function executeHover(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolResult {
  const position = getPositionFromLineCharacter(service, filePath, line, character);
  const hover = service.getQuickInfoAtPosition(filePath, position);

  if (!hover) {
    return {
      success: true,
      output: 'No hover information available',
      metadata: { found: false },
    };
  }

  const displayParts = hover.displayParts?.map((p) => p.text).join('') || '';
  const documentation = hover.documentation?.map((d) => d.text).join('\n') || '';
  const tags =
    hover.tags
      ?.map((t) => `@${t.name} ${t.text?.map((tt) => tt.text).join('') || ''}`)
      .join('\n') || '';

  const lines: string[] = [];
  if (displayParts) {
    lines.push('```typescript');
    lines.push(displayParts);
    lines.push('```');
  }
  if (documentation) {
    lines.push('');
    lines.push(documentation);
  }
  if (tags) {
    lines.push('');
    lines.push(tags);
  }

  return {
    success: true,
    output: lines.join('\n') || 'No information',
    metadata: {
      found: true,
      displayParts,
      documentation,
      kind: hover.kind,
      kindModifiers: hover.kindModifiers,
    },
  };
}

/**
 * 执行 documentSymbols 操作
 */
function executeDocumentSymbols(service: ts.LanguageService, filePath: string): ToolResult {
  const navTree = service.getNavigationTree(filePath);

  if (!navTree) {
    return {
      success: true,
      output: 'No symbols found',
      metadata: { found: false },
    };
  }

  const symbols: Array<{ name: string; kind: string; line: number }> = [];

  function walkTree(node: ts.NavigationTree, depth = 0) {
    const span = node.spans[0];
    if (span) {
      const start = getLineAndCharacter(service, filePath, span.start);
      symbols.push({
        name: '  '.repeat(depth) + node.text,
        kind: node.kind,
        line: start.line + 1,
      });
    }
    for (const child of node.childItems || []) {
      walkTree(child, depth + 1);
    }
  }

  walkTree(navTree);

  const lines: string[] = [`Found ${symbols.length} symbol(s):\n`];
  for (const sym of symbols) {
    lines.push(`  ${sym.name} (${sym.kind}) - Line ${sym.line}`);
  }

  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      found: true,
      count: symbols.length,
      symbols,
    },
  };
}

const schema = z
  .object({
    operation: z.enum(OPERATIONS).describe('LSP operation to perform'),
    filePath: z.string().min(1).describe('Absolute or relative path to the file'),
    line: z.number().int().min(1).describe('Line number (1-based)').optional(),
    character: z.number().int().min(1).describe('Character offset (1-based)').optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (['goToDefinition', 'findReferences', 'hover'].includes(data.operation)) {
        return data.line !== undefined && data.character !== undefined;
      }
      return true;
    },
    {
      message:
        'line and character are required for goToDefinition, findReferences, and hover operations',
    }
  );

export interface LspToolOptions {
  allowedDirectories?: string[];
}

export class LspTool extends BaseTool<typeof schema> {
  readonly name = 'lsp';
  readonly description = LSP_TOOL_DESCRIPTION;
  readonly parameters = schema;

  private readonly allowedDirectories: string[];

  constructor(options?: LspToolOptions) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options?.allowedDirectories);
  }

  async execute(
    args: z.infer<typeof schema>,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const { operation, filePath, line = 1, character = 1 } = args;

    // 路径安全检查
    const absolutePath = ensurePathWithinAllowed(
      path.resolve(filePath),
      this.allowedDirectories,
      'LSP_PATH_NOT_ALLOWED'
    );

    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      throw new ToolExecutionError(`File not found: ${filePath}`, 2030);
    }

    // 检查文件类型
    const ext = path.extname(absolutePath).toLowerCase();
    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    if (!supportedExtensions.includes(ext)) {
      throw new ToolExecutionError(
        `Unsupported file type: ${ext}. Supported: ${supportedExtensions.join(', ')}`,
        2031
      );
    }

    try {
      const service = createLanguageService(absolutePath);

      switch (operation) {
        case 'goToDefinition':
          return executeGoToDefinition(service, absolutePath, line, character);
        case 'findReferences':
          return executeFindReferences(service, absolutePath, line, character);
        case 'hover':
          return executeHover(service, absolutePath, line, character);
        case 'documentSymbols':
          return executeDocumentSymbols(service, absolutePath);
        default:
          throw new ToolExecutionError(`Unknown operation: ${operation}`, 2032);
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        `LSP operation failed: ${error instanceof Error ? error.message : String(error)}`,
        2033
      );
    }
  }
}

export default LspTool;
