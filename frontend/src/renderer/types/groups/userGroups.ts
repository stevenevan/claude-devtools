import type { ParsedMessage } from '../data';

export interface CommandInfo {

  name: string;

  args?: string;

  raw: string;

  startIndex: number;

  endIndex: number;
}

export interface ImageData {

  id: string;

  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

  data?: string;
}

export interface FileReference {

  path: string;

  lineRange?: {
    start: number;
    end?: number;
  };

  raw: string;
}

export interface UserGroupContent {

  text?: string;

  rawText?: string;

  commands: CommandInfo[];

  images: ImageData[];

  fileReferences: FileReference[];
}

export interface UserGroup {

  id: string;

  message: ParsedMessage;

  timestamp: Date;

  content: UserGroupContent;

  index: number;
}
