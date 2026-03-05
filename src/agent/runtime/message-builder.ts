import type { LLMRequestMessage } from '../../providers';
import type { HookContext, Message } from '../../core/types';
import type { MemoryManager } from '../../storage';
import { contentToText } from '../../utils';

interface PromptHookExecutor {
  executeSystemPromptHooks(prompt: string, ctx: HookContext): Promise<string>;
  executeUserPromptHooks(prompt: string, ctx: HookContext): Promise<string>;
}

interface BuildMessageBaseOptions {
  hookManager: PromptHookExecutor;
  getHookContext: () => HookContext;
  createMessageId?: () => string;
}

export async function buildUserMessage(
  options: BuildMessageBaseOptions & {
    userContent: string | LLMRequestMessage['content'];
  }
): Promise<Message> {
  const {
    userContent,
    hookManager,
    getHookContext,
    createMessageId = () => crypto.randomUUID(),
  } = options;
  const ctx = getHookContext();
  let processedUserContent = userContent;
  if (typeof processedUserContent === 'string') {
    processedUserContent = await hookManager.executeUserPromptHooks(processedUserContent, ctx);
  } else if (Array.isArray(processedUserContent)) {
    const nextContent: typeof processedUserContent = [];
    for (const part of processedUserContent) {
      if (part.type === 'text') {
        const text = await hookManager.executeUserPromptHooks(part.text, ctx);
        nextContent.push({ ...part, text });
        continue;
      }
      nextContent.push(part);
    }
    processedUserContent = nextContent;
  }

  return {
    messageId: createMessageId(),
    role: 'user',
    content: processedUserContent,
  };
}

export async function buildInitialMessages(
  options: BuildMessageBaseOptions & {
    systemPrompt?: string;
    userContent: string | LLMRequestMessage['content'];
  }
): Promise<Message[]> {
  const {
    systemPrompt,
    userContent,
    hookManager,
    getHookContext,
    createMessageId = () => crypto.randomUUID(),
  } = options;
  const messages: Message[] = [];
  const ctx = getHookContext();

  if (systemPrompt) {
    const processedSystemPrompt = await hookManager.executeSystemPromptHooks(systemPrompt, ctx);
    messages.push({
      messageId: createMessageId(),
      role: 'system',
      content: processedSystemPrompt,
    });
  }

  messages.push(
    await buildUserMessage({
      userContent,
      hookManager,
      getHookContext,
      createMessageId,
    })
  );
  return messages;
}

export function extractSystemPrompt(messages: Message[]): string {
  const systemMessage = messages.find((message) => message.role === 'system');
  if (!systemMessage) return '';
  return contentToText(systemMessage.content);
}

export async function ensureSystemMessageForExistingSession(
  options: BuildMessageBaseOptions & {
    messages: Message[];
    existingSessionPrompt?: string;
    systemPrompt?: string;
  }
): Promise<Message[]> {
  const {
    messages,
    existingSessionPrompt,
    systemPrompt,
    hookManager,
    getHookContext,
    createMessageId = () => crypto.randomUUID(),
  } = options;
  const hasSystemMessage = messages.some((message) => message.role === 'system');
  if (hasSystemMessage) {
    return messages;
  }

  let prompt = existingSessionPrompt;
  if (!prompt && systemPrompt) {
    prompt = await hookManager.executeSystemPromptHooks(systemPrompt, getHookContext());
  }

  if (!prompt) {
    return messages;
  }

  return [
    {
      messageId: createMessageId(),
      role: 'system',
      content: prompt,
    },
    ...messages,
  ];
}

export async function prepareMessagesForRun(options: {
  memoryManager?: MemoryManager;
  sessionId: string;
  userContent: string | LLMRequestMessage['content'];
  buildInitialMessages: (userContent: string | LLMRequestMessage['content']) => Promise<Message[]>;
  buildUserMessage: (userContent: string | LLMRequestMessage['content']) => Promise<Message>;
  restoreMessages: () => Promise<Message[]>;
  ensureSystemMessageForExistingSession: (
    messages: Message[],
    existingSessionPrompt?: string
  ) => Promise<Message[]>;
}): Promise<{ messages: Message[]; saveFromIndex: number }> {
  const {
    memoryManager,
    sessionId,
    userContent,
    buildInitialMessages: buildInitialMessagesFn,
    buildUserMessage: buildUserMessageFn,
    restoreMessages,
    ensureSystemMessageForExistingSession: ensureSystemMessageForExistingSessionFn,
  } = options;
  if (!memoryManager) {
    const messages = await buildInitialMessagesFn(userContent);
    return { messages, saveFromIndex: 0 };
  }

  await memoryManager.initialize();
  const existingSession = memoryManager.getSession(sessionId);

  if (existingSession) {
    const restoredMessages = await restoreMessages();
    const messagesWithSystem = await ensureSystemMessageForExistingSessionFn(
      restoredMessages,
      existingSession.systemPrompt
    );

    const saveFromIndex = messagesWithSystem.length;
    const userMessage = await buildUserMessageFn(userContent);
    return {
      messages: [...messagesWithSystem, userMessage],
      saveFromIndex,
    };
  }

  const messages = await buildInitialMessagesFn(userContent);
  await memoryManager.createSession(sessionId, extractSystemPrompt(messages));
  const firstNonSystemIndex = messages.findIndex((message) => message.role !== 'system');
  if (firstNonSystemIndex === -1) {
    return { messages, saveFromIndex: messages.length };
  }
  return { messages, saveFromIndex: firstNonSystemIndex };
}
