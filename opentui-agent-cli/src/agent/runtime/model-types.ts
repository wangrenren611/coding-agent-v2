export type AgentModelOption = {
  id: string;
  name: string;
  provider: string;
  apiKeyEnv: string;
  configured: boolean;
  current: boolean;
};

export type AgentModelSwitchResult = {
  modelId: string;
  modelLabel: string;
};
