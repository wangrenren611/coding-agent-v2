import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBuffer, createMessageBuffer } from './message-buffer';
import { MessageFactory } from './message';

describe('MessageBuffer', () => {
  let buffer: MessageBuffer;
  let flushCallback: any;

  beforeEach(() => {
    buffer = createMessageBuffer({
      maxBufferSize: 3,
      flushInterval: 1000,
      enabled: true,
    });

    flushCallback = vi.fn().mockResolvedValue(undefined);
    buffer.setOnFlush(flushCallback);
  });

  describe('基础功能', () => {
    it('初始大小应为 0', () => {
      expect(buffer.size()).toBe(0);
    });

    it('应该正确添加消息', async () => {
      const message = MessageFactory.createUserMessage('Test');

      await buffer.add(message);

      expect(buffer.size()).toBe(1);
    });

    it('应该正确更新消息', async () => {
      await buffer.update('msg_1', { content: 'Test' });

      expect(buffer.size()).toBe(1);
    });

    it('更新已存在的消息应合并更新', async () => {
      await buffer.update('msg_1', { content: 'First' });
      await buffer.update('msg_1', { content: 'Second' });

      expect(buffer.size()).toBe(1);
    });
  });

  describe('自动刷新', () => {
    it('达到最大缓冲大小时应自动刷新', async () => {
      const message1 = MessageFactory.createUserMessage('1');
      const message2 = MessageFactory.createUserMessage('2');
      const message3 = MessageFactory.createUserMessage('3');

      await buffer.add(message1);
      await buffer.add(message2);
      await buffer.add(message3);

      expect(flushCallback).toHaveBeenCalledTimes(1);
      expect(buffer.size()).toBe(0);
    });

    it('应该启动定时器', () => {
      buffer.start();
      expect(buffer.isEnabled()).toBe(true);
      buffer.stop();
    });

    it('应该停止定时器', () => {
      buffer.start();
      buffer.stop();
      // 验证停止后不会报错
      expect(buffer.isEnabled()).toBe(true);
    });
  });

  describe('手动刷新', () => {
    it('应该正确手动刷新', async () => {
      const message = MessageFactory.createUserMessage('Test');
      await buffer.add(message);

      await buffer.flush();

      expect(flushCallback).toHaveBeenCalledTimes(1);
      expect(buffer.size()).toBe(0);
    });

    it('空缓冲区不应触发刷新', async () => {
      await buffer.flush();

      expect(flushCallback).not.toHaveBeenCalled();
    });

    it('刷新失败应保留消息', async () => {
      flushCallback.mockRejectedValue(new Error('Flush failed'));

      const message = MessageFactory.createUserMessage('Test');
      await buffer.add(message);

      await buffer.flush();

      expect(buffer.size()).toBe(1);
    });
  });

  describe('启用/禁用', () => {
    it('应该正确禁用', () => {
      buffer.disable();
      expect(buffer.isEnabled()).toBe(false);
    });

    it('禁用后添加消息不应生效', async () => {
      buffer.disable();
      const message = MessageFactory.createUserMessage('Test');

      await buffer.add(message);

      expect(buffer.size()).toBe(0);
    });

    it('应该正确启用', () => {
      buffer.disable();
      buffer.enable();
      expect(buffer.isEnabled()).toBe(true);
    });
  });

  describe('生命周期', () => {
    it('应该正确关闭', async () => {
      buffer.start();
      const message = MessageFactory.createUserMessage('Test');
      await buffer.add(message);

      await buffer.close();

      expect(flushCallback).toHaveBeenCalled();
    });
  });

  describe('批量操作', () => {
    it('回调应接收所有缓冲的消息', async () => {
      const msg1 = MessageFactory.createUserMessage('1');
      const msg2 = MessageFactory.createUserMessage('2');

      await buffer.add(msg1);
      await buffer.add(msg2);

      await buffer.flush();

      expect(flushCallback).toHaveBeenCalledTimes(1);
      const callArg = flushCallback.mock.calls[0][0];
      expect(callArg).toHaveLength(2);
    });
  });
});
