import { describe, expect, it } from 'vitest';
import { LiveRegionManager } from '../live-region';

function createMockStream() {
  let output = '';
  return {
    write(chunk: string) {
      output += chunk;
      return true;
    },
    getOutput() {
      return output;
    },
  };
}

describe('LiveRegionManager', () => {
  it('renders and clears live lines', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['line-1']);
    manager.clear();

    const output = mock.getOutput();
    expect(output).toContain('line-1');
    expect(output).toContain('\u001B[2K');
  });

  it('hides live area while writing immutable log', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['status']);
    manager.withHidden(() => {
      mock.write('hello\n');
    });

    const output = mock.getOutput();
    expect(output).toContain('hello\n');
    expect(output).toContain('status');
  });
});
