export type EndpointProviderSummary = {
  id: string;
  provider: {
    name: string;
    alias?: string;
  };
};

export type EndpointModelSummary = {
  id: string;
  owned_by?: string;
  parent?: string;
  type?: string;
  custom?: boolean;
  root?: string;
};

export type CopyHandler = (text: string, key?: string) => void | Promise<unknown>;
