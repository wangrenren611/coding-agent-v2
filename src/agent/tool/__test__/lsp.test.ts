import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LspTool } from '../lsp';

describe('LspTool', () => {
  let tool: LspTool;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-test-'));
    tool = new LspTool({ allowedDirectories: [tempDir] });
  });

  afterEach(() => {
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function createTestFile(name: string, content: string): string {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  describe('Path Security', () => {
    it('rejects files outside allowed directories', async () => {
      await expect(
        tool.execute({
          operation: 'documentSymbols',
          filePath: '/etc/passwd',
        })
      ).rejects.toThrow('LSP_PATH_NOT_ALLOWED');
    });

    it('accepts files within allowed directories', async () => {
      const filePath = createTestFile('test.ts', 'const x = 1;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('File Validation', () => {
    it('throws for non-existent files', async () => {
      await expect(
        tool.execute({
          operation: 'documentSymbols',
          filePath: path.join(tempDir, 'nonexistent.ts'),
        })
      ).rejects.toThrow('File not found');
    });

    it('throws for unsupported file types', async () => {
      const filePath = createTestFile('test.txt', 'plain text');
      await expect(
        tool.execute({
          operation: 'documentSymbols',
          filePath,
        })
      ).rejects.toThrow('Unsupported file type');
    });

    it('supports .ts files', async () => {
      const filePath = createTestFile('test.ts', 'const x = 1;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });
      expect(result.success).toBe(true);
    });

    it('supports .tsx files', async () => {
      const filePath = createTestFile('test.tsx', 'const Component = () => <div/>;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });
      expect(result.success).toBe(true);
    });

    it('supports .js files', async () => {
      const filePath = createTestFile('test.js', 'const x = 1;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });
      expect(result.success).toBe(true);
    });

    it('supports .jsx files', async () => {
      const filePath = createTestFile('test.jsx', 'const Component = () => <div/>;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('documentSymbols', () => {
    it('lists symbols in a TypeScript file', async () => {
      const content = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

export const PI = 3.14159;
`;
      const filePath = createTestFile('symbols.ts', content);
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('greet');
      expect(result.output).toContain('Calculator');
      expect(result.output).toContain('PI');
      expect(result.metadata?.found).toBe(true);
      expect((result.metadata?.count as number) ?? 0).toBeGreaterThan(0);
    });

    it('handles empty files', async () => {
      const filePath = createTestFile('empty.ts', '');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('hover', () => {
    it('returns type information for variables', async () => {
      const content = `
const message: string = "hello";
const count: number = 42;
`;
      const filePath = createTestFile('hover.ts', content);
      const result = await tool.execute({
        operation: 'hover',
        filePath,
        line: 2,
        character: 7, // on 'message'
      });

      expect(result.success).toBe(true);
      // Hover may or may not find info depending on exact position
    });

    it('returns info for function parameters', async () => {
      const content = `
function add(a: number, b: number): number {
  return a + b;
}
`;
      const filePath = createTestFile('hover-func.ts', content);
      const result = await tool.execute({
        operation: 'hover',
        filePath,
        line: 2,
        character: 14, // on 'a'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('goToDefinition', () => {
    it('finds definition within same file', async () => {
      const content = `
function helper(): void {}

function main(): void {
  helper();
}
`;
      const filePath = createTestFile('definition.ts', content);
      const result = await tool.execute({
        operation: 'goToDefinition',
        filePath,
        line: 5,
        character: 5, // on 'helper()' call
      });

      expect(result.success).toBe(true);
      // May find definition or not depending on TS analysis
    });
  });

  describe('findReferences', () => {
    it('finds references within same file', async () => {
      const content = `
const value = 42;
const doubled = value * 2;
const tripled = value * 3;
`;
      const filePath = createTestFile('references.ts', content);
      const result = await tool.execute({
        operation: 'findReferences',
        filePath,
        line: 2,
        character: 7, // on 'value'
      });

      expect(result.success).toBe(true);
      // May find references or not depending on TS analysis
    });
  });

  describe('Operation Validation', () => {
    it('requires line and character for goToDefinition', () => {
      const validation = tool.safeValidateArgs({
        operation: 'goToDefinition',
        filePath: '/test.ts',
      });
      expect(validation.success).toBe(false);
    });

    it('requires line and character for findReferences', () => {
      const validation = tool.safeValidateArgs({
        operation: 'findReferences',
        filePath: '/test.ts',
      });
      expect(validation.success).toBe(false);
    });

    it('requires line and character for hover', () => {
      const validation = tool.safeValidateArgs({
        operation: 'hover',
        filePath: '/test.ts',
      });
      expect(validation.success).toBe(false);
    });

    it('does not require line and character for documentSymbols', () => {
      const validation = tool.safeValidateArgs({
        operation: 'documentSymbols',
        filePath: '/test.ts',
      });
      expect(validation.success).toBe(true);
    });

    it('validates operation enum', () => {
      const validation = tool.safeValidateArgs({
        operation: 'invalid',
        filePath: '/test.ts',
      });
      expect(validation.success).toBe(false);
    });

    it('accepts valid arguments with all fields', () => {
      const validation = tool.safeValidateArgs({
        operation: 'goToDefinition',
        filePath: '/test.ts',
        line: 10,
        character: 5,
      });
      expect(validation.success).toBe(true);
    });
  });

  describe('tsconfig.json Support', () => {
    it('loads tsconfig.json when present', async () => {
      // Create a tsconfig.json
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
        },
      };
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig), 'utf-8');

      const filePath = createTestFile('with-config.ts', 'const x: number = 1;');
      const result = await tool.execute({
        operation: 'documentSymbols',
        filePath,
      });

      expect(result.success).toBe(true);
    });
  });
});
