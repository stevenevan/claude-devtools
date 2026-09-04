import { JSX } from 'react';

import { VirtualListSkeleton } from './VirtualList';

interface LoadingStateProps {
  label?: string;
  rows?: number;
}

export const LoadingState = ({
  label = 'Loading',
  rows = 8,
}: Readonly<LoadingStateProps>): JSX.Element => {
  return <VirtualListSkeleton rows={rows} ariaLabel={label} />;
};
