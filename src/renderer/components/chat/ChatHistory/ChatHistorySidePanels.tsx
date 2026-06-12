import { SessionContextPanel } from '../SessionContextPanel/index';
import { SessionMinimap } from '../SessionMinimap';
import { TodoPanel } from '../TodoPanel';

import type { ContextInjection, ContextPhaseInfo } from '@renderer/types/contextInjection';
import type { ChatItem } from '@renderer/types/groups';

interface ChatHistorySidePanelsProps {
  items: ChatItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onMinimapJump: (index: number) => void;
  isTodoPanelVisible: boolean;
  hasTodoData: boolean;
  todoData: unknown;
  onCloseTodo: () => void;
  isContextPanelVisible: boolean;
  contextInjections: ContextInjection[];
  onCloseContext: () => void;
  projectRoot?: string;
  onNavigateToTurn: (turnIndex: number) => void;
  onNavigateToTool: (turnIndex: number, toolUseId: string) => void;
  onNavigateToUserGroup: (turnIndex: number) => void;
  totalSessionTokens?: number;
  phaseInfo?: ContextPhaseInfo;
  selectedPhase: number | null;
  onPhaseChange: (phase: number | null) => void;
}

export const ChatHistorySidePanels = ({
  items,
  scrollContainerRef,
  onMinimapJump,
  isTodoPanelVisible,
  hasTodoData,
  todoData,
  onCloseTodo,
  isContextPanelVisible,
  contextInjections,
  onCloseContext,
  projectRoot,
  onNavigateToTurn,
  onNavigateToTool,
  onNavigateToUserGroup,
  totalSessionTokens,
  phaseInfo,
  selectedPhase,
  onPhaseChange,
}: ChatHistorySidePanelsProps): JSX.Element => {
  return (
    <>
      {items.length >= 5 && (
        <SessionMinimap
          items={items}
          scrollContainerRef={scrollContainerRef}
          onJumpToIndex={onMinimapJump}
          className="border-border/30 border-l"
        />
      )}

      {isTodoPanelVisible && hasTodoData && (
        <div className="border-border w-72 shrink-0 border-l">
          <TodoPanel todoData={todoData} onClose={onCloseTodo} />
        </div>
      )}

      {isContextPanelVisible && contextInjections.length > 0 && (
        <div className="w-80 shrink-0">
          <SessionContextPanel
            injections={contextInjections}
            onClose={onCloseContext}
            projectRoot={projectRoot}
            onNavigateToTurn={onNavigateToTurn}
            onNavigateToTool={onNavigateToTool}
            onNavigateToUserGroup={onNavigateToUserGroup}
            totalSessionTokens={totalSessionTokens}
            phaseInfo={phaseInfo}
            selectedPhase={selectedPhase}
            onPhaseChange={onPhaseChange}
          />
        </div>
      )}
    </>
  );
};
