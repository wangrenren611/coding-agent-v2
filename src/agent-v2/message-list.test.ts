import { describe, it, expect, beforeEach } from 'vitest';
import { MessageList } from './message-list';
import { MessageFactory } from './message';

describe('MessageList', () => {
    let messageList: MessageList;

    beforeEach(() => {
        messageList = new MessageList();
    });

    describe('基础功能', () => {
        it('应该创建一个空的消息列表', () => {
            expect(messageList.length).toBe(0);
            expect(messageList.isEmpty).toBe(true);
        });

        it('应该正确添加用户消息', () => {
            const message = messageList.addUserMessage('Hello');
            expect(messageList.length).toBe(1);
            expect(message.role).toBe('user');
            expect(message.content).toBe('Hello');
        });

        it('应该正确添加助手消息', () => {
            const message = messageList.addAssistantMessage({
                content: 'Hi there!',
            });
            expect(messageList.length).toBe(1);
            expect(message.role).toBe('assistant');
            expect(message.content).toBe('Hi there!');
        });

        it('应该正确添加带工具调用的助手消息', () => {
            const toolCalls = [
                { id: 'tool_1', type: 'function' as const, name: 'test', arguments: '{}' }
            ];
            const message = messageList.addAssistantMessage({
                content: '',
                tool_calls: toolCalls,
            });
            expect(message.tool_calls).toHaveLength(1);
            expect(message.tool_calls?.[0].name).toBe('test');
        });
    });

    describe('系统消息', () => {
        it('应该正确设置系统消息', () => {
            const systemMsg = messageList.setSystemMessage('You are helpful');
            expect(messageList.systemMessage).toBeDefined();
            expect(messageList.systemMessage?.content).toBe('You are helpful');
            expect(systemMsg.role).toBe('system');
        });

        it('应该能够更新系统消息', () => {
            messageList.setSystemMessage('Original');
            messageList.setSystemMessage('Updated');
            expect(messageList.systemMessage?.content).toBe('Updated');
        });
    });

    describe('消息查询', () => {
        beforeEach(() => {
            messageList.addUserMessage('First');
            messageList.addAssistantMessage({ content: 'Second' });
            messageList.addUserMessage('Third');
        });

        it('应该正确获取最后一条消息', () => {
            const last = messageList.lastMessage;
            expect(last?.content).toBe('Third');
        });

        it('应该正确按角色过滤消息', () => {
            const users = messageList.getUserMessages();
            expect(users).toHaveLength(2);
        });

        it('应该正确按 ID 查找消息', () => {
            const firstMessage = messageList.getAt(0);
            const found = messageList.getById(firstMessage!.messageId);
            expect(found?.messageId).toBe(firstMessage?.messageId);
        });

        it('应该返回 undefined 当 ID 不存在时', () => {
            const found = messageList.getById('non_existent');
            expect(found).toBeUndefined();
        });
    });

    describe('消息更新', () => {
        it('应该正确更新最后一条消息', () => {
            messageList.addAssistantMessage({ content: 'Initial' });
            
            const result = messageList.updateLastMessage({ content: 'Updated' });
            
            expect(result).toBe(true);
            expect(messageList.lastMessage?.content).toBe('Updated');
        });

        it('应该返回 false 当列表为空时', () => {
            const result = messageList.updateLastMessage({ content: 'Test' });
            expect(result).toBe(false);
        });

        it('应该根据 messageId 更新消息', () => {
            const msg = messageList.addUserMessage('Original');
            
            const result = messageList.updateMessageById(msg.messageId, { content: 'Updated' });
            
            expect(result).toBe(true);
            expect(messageList.getById(msg.messageId)?.content).toBe('Updated');
        });

        it('应该返回 false 当更新的消息不存在', () => {
            messageList.addUserMessage('Test');
            const result = messageList.updateMessageById('non_existent', { content: 'Updated' });
            expect(result).toBe(false);
        });
    });

    describe('消息删除', () => {
        it('应该正确删除指定消息', () => {
            const msg = messageList.addUserMessage('To delete');
            expect(messageList.length).toBe(1);
            
            const result = messageList.delete(msg.messageId);
            
            expect(result).toBe(true);
            expect(messageList.length).toBe(0);
        });

        it('应该正确清空所有消息', () => {
            messageList.addUserMessage('1');
            messageList.addUserMessage('2');
            messageList.addUserMessage('3');
            
            messageList.clear();
            
            expect(messageList.length).toBe(0);
        });

        it('应该正确保留最后 N 条消息', () => {
            messageList.addUserMessage('1');
            messageList.addUserMessage('2');
            messageList.addUserMessage('3');
            messageList.addUserMessage('4');
            messageList.addUserMessage('5');
            
            messageList.truncate(2);
            
            expect(messageList.length).toBe(2);
            expect(messageList.lastMessage?.content).toBe('5');
        });
    });

    describe('工具消息', () => {
        it('应该正确添加工具结果消息', () => {
            const msg = messageList.addToolResult('tool_call_id', 'Result content');
            expect(msg.role).toBe('tool');
            expect(msg.content).toBe('Result content');
            expect(msg.tool_call_id).toBe('tool_call_id');
        });
    });

    describe('并发控制', () => {
        it('应该正确处理异步添加', async () => {
            const msg = MessageFactory.createUserMessage('Async test');
            
            await messageList.addAsync(msg);
            
            expect(messageList.length).toBe(1);
        });

        it('应该正确处理异步更新', async () => {
            const msg = messageList.addUserMessage('Original');
            
            const result = await messageList.updateMessageByIdAsync(msg.messageId, { content: 'Updated' });
            
            expect(result).toBe(true);
            expect(messageList.getById(msg.messageId)?.content).toBe('Updated');
        });
    });

    describe('事件系统', () => {
        it('应该在添加消息时触发事件', () => {
            const events: string[] = [];
            messageList.on('add', (event) => {
                events.push(event.type);
            });
            
            messageList.addUserMessage('Test');
            
            expect(events).toContain('add');
        });

        it('应该在更新消息时触发事件', () => {
            const events: string[] = [];
            messageList.on('update', (event) => {
                events.push(event.type);
            });
            
            messageList.addUserMessage('Test');
            messageList.updateLastMessage({ content: 'Updated' });
            
            expect(events).toContain('update');
        });

        it('应该在删除消息时触发事件', () => {
            const events: string[] = [];
            messageList.on('delete', (event) => {
                events.push(event.type);
            });
            
            const msg = messageList.addUserMessage('Test');
            messageList.delete(msg.messageId);
            
            expect(events).toContain('delete');
        });
    });
});
