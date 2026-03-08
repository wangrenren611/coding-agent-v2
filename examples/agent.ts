import { loadEnvFiles, ProviderRegistry } from '../src';
import { Agent } from '../src/agent-v2/agent';

async function main() {
     await loadEnvFiles(process.cwd());
    const provider = ProviderRegistry.createFromEnv('minimax-2.5');
    const agent = new Agent({
        systemPrompt: '你是一个智能助手',
        llmProvider: provider,
        plugins: [],
        sessionId: '123',
    });

    await  agent.run('你好');
}

main().then(() => {
    console.log('done');
}).catch((error) => {
    console.error('error', error);
});
