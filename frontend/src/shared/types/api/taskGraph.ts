export interface TaskGraphMeta {
  uuid: string;
  taskCount: number;
  latestMtime: number;
  label?: string | null;
}

export interface TaskNode {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
}
