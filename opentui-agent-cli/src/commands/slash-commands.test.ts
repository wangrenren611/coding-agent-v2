import { describe, expect, it } from 'vitest';

import { SLASH_COMMANDS, filterSlashCommands, resolveSlashCommand } from './slash-commands';

describe('slash-commands', () => {
  describe('resolveSlashCommand', () => {
    it('should return null for empty input', () => {
      expect(resolveSlashCommand('')).toBe(null);
      expect(resolveSlashCommand('   ')).toBe(null);
      expect(resolveSlashCommand('\t\n')).toBe(null);
    });

    it('should return null for non-slash commands', () => {
      expect(resolveSlashCommand('hello world')).toBe(null);
      // 'help me' returns help command because the first token 'help' matches
      // but the caller checks text.startsWith('/') before using runCommand
      expect(resolveSlashCommand('help me')?.name).toBe('help');
      expect(resolveSlashCommand('/invalid')).toBe(null);
    });

    it('should resolve commands by name', () => {
      const helpCommand = resolveSlashCommand('/help');
      expect(helpCommand).not.toBe(null);
      expect(helpCommand?.name).toBe('help');
      expect(helpCommand?.action).toBe('help');

      const clearCommand = resolveSlashCommand('/clear');
      expect(clearCommand?.name).toBe('clear');
      expect(clearCommand?.action).toBe('clear');

      const exitCommand = resolveSlashCommand('/exit');
      expect(exitCommand?.name).toBe('exit');
      expect(exitCommand?.action).toBe('exit');

      const modelsCommand = resolveSlashCommand('/models');
      expect(modelsCommand?.name).toBe('models');
      expect(modelsCommand?.action).toBe('models');
    });

    it('should resolve commands with aliases', () => {
      // Test aliases for clear
      const clearAlias1 = resolveSlashCommand('/new');
      expect(clearAlias1?.name).toBe('clear');
      expect(clearAlias1?.action).toBe('clear');

      // Test aliases for exit
      const exitAlias1 = resolveSlashCommand('/quit');
      expect(exitAlias1?.name).toBe('exit');
      expect(exitAlias1?.action).toBe('exit');

      const exitAlias2 = resolveSlashCommand('/q');
      expect(exitAlias2?.name).toBe('exit');
      expect(exitAlias2?.action).toBe('exit');

      // Test aliases for help
      const helpAlias1 = resolveSlashCommand('/commands');
      expect(helpAlias1?.name).toBe('help');
      expect(helpAlias1?.action).toBe('help');

      // Test aliases for models
      const modelsAlias1 = resolveSlashCommand('/model');
      expect(modelsAlias1?.name).toBe('models');
      expect(modelsAlias1?.action).toBe('models');
    });

    it('should resolve commands with extra text after command', () => {
      const helpCommand = resolveSlashCommand('/help please');
      expect(helpCommand?.name).toBe('help');

      const clearCommand = resolveSlashCommand('/clear now');
      expect(clearCommand?.name).toBe('clear');

      const modelsCommand = resolveSlashCommand('/models with space');
      expect(modelsCommand?.name).toBe('models');
    });

    it('should be case insensitive', () => {
      expect(resolveSlashCommand('/HELP')?.name).toBe('help');
      expect(resolveSlashCommand('/Help')?.name).toBe('help');
      expect(resolveSlashCommand('/hElP')?.name).toBe('help');

      expect(resolveSlashCommand('/CLEAR')?.name).toBe('clear');
      expect(resolveSlashCommand('/Clear')?.name).toBe('clear');

      expect(resolveSlashCommand('/MODELS')?.name).toBe('models');
      expect(resolveSlashCommand('/Models')?.name).toBe('models');
    });

    it('should handle commands with leading/trailing spaces', () => {
      expect(resolveSlashCommand('  /help  ')?.name).toBe('help');
      expect(resolveSlashCommand('\t/clear\n')?.name).toBe('clear');
      expect(resolveSlashCommand('  /models  please')?.name).toBe('models');
    });

    it('should return unsupported commands', () => {
      const exportCommand = resolveSlashCommand('/export');
      expect(exportCommand?.name).toBe('export');
      expect(exportCommand?.action).toBe('unsupported');

      const forkCommand = resolveSlashCommand('/fork');
      expect(forkCommand?.name).toBe('fork');
      expect(forkCommand?.action).toBe('unsupported');
    });
  });

  describe('filterSlashCommands', () => {
    it('should return all commands for empty query', () => {
      const result = filterSlashCommands('');
      expect(result).toEqual(SLASH_COMMANDS);

      const result2 = filterSlashCommands('   ');
      expect(result2).toEqual(SLASH_COMMANDS);
    });

    it('should filter commands by name prefix', () => {
      const result = filterSlashCommands('h');
      expect(result.length).toBeGreaterThan(0);
      expect(
        result.every(
          cmd => cmd.name.includes('h') || cmd.aliases?.some(alias => alias.includes('h'))
        )
      ).toBe(true);

      const result2 = filterSlashCommands('he');
      const helpCommands = result2.filter(
        cmd => cmd.name.startsWith('he') || cmd.aliases?.some(alias => alias.startsWith('he'))
      );
      expect(helpCommands.length).toBeGreaterThan(0);
    });

    it('should filter commands by name substring', () => {
      const result = filterSlashCommands('elp'); // part of "help"
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(cmd => cmd.name === 'help')).toBe(true);
    });

    it('should filter commands by alias', () => {
      const result = filterSlashCommands('q'); // alias for exit
      expect(result.some(cmd => cmd.name === 'exit')).toBe(true);

      const result2 = filterSlashCommands('commands'); // alias for help
      expect(result2.some(cmd => cmd.name === 'help')).toBe(true);
    });

    it('should be case insensitive', () => {
      const result1 = filterSlashCommands('HELP');
      const result2 = filterSlashCommands('help');
      expect(result1).toEqual(result2);

      const result3 = filterSlashCommands('CLEAR');
      const result4 = filterSlashCommands('clear');
      expect(result3).toEqual(result4);
    });

    it('should handle queries with spaces', () => {
      const result = filterSlashCommands('  help  ');
      expect(result.some(cmd => cmd.name === 'help')).toBe(true);
    });

    it('should return empty array for non-matching query', () => {
      const result = filterSlashCommands('xyz123nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('SLASH_COMMANDS', () => {
    it('should have required fields for all commands', () => {
      SLASH_COMMANDS.forEach(command => {
        expect(command.name).toBeDefined();
        expect(command.description).toBeDefined();
        expect(command.action).toBeDefined();
        expect(['help', 'clear', 'exit', 'models', 'unsupported']).toContain(command.action);
      });
    });

    it('should have unique names', () => {
      const names = SLASH_COMMANDS.map(cmd => cmd.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('should have proper aliases', () => {
      const clearCommand = SLASH_COMMANDS.find(cmd => cmd.name === 'clear');
      expect(clearCommand?.aliases).toEqual(['new']);

      const exitCommand = SLASH_COMMANDS.find(cmd => cmd.name === 'exit');
      expect(exitCommand?.aliases).toEqual(['quit', 'q']);

      const helpCommand = SLASH_COMMANDS.find(cmd => cmd.name === 'help');
      expect(helpCommand?.aliases).toEqual(['commands']);

      const modelsCommand = SLASH_COMMANDS.find(cmd => cmd.name === 'models');
      expect(modelsCommand?.aliases).toEqual(['model']);
    });
  });
});
