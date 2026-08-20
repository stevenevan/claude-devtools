export interface SourceRequestToken {
  generation: number;
  request: number;
}

export interface SourceRequestGate {
  switchSource: () => void;
  begin: (lane: string) => SourceRequestToken;
  isCurrent: (lane: string, token: SourceRequestToken) => boolean;
}

export const createSourceRequestGate = (): SourceRequestGate => {
  let generation = 0;
  const requests = new Map<string, number>();

  return {
    switchSource: () => {
      generation += 1;
    },
    begin: (lane) => {
      const request = (requests.get(lane) ?? 0) + 1;
      requests.set(lane, request);
      return { generation, request };
    },
    isCurrent: (lane, token) =>
      token.generation === generation && token.request === requests.get(lane),
  };
};
