import { Skeleton } from '@renderer/components/ui/skeleton';

export const SkeletonLoader = (): React.JSX.Element => {
  const widths = [
    { header: '30%', title: '75%', sub: '90%' },
    { header: '22%', title: '60%', sub: '80%' },
    { header: '26%', title: '85%', sub: '65%' },
  ];

  return (
    <div className="p-4">
      <div className="space-y-3">
        {widths.map((w, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 rounded-xs" style={{ width: w.header }} />
            <Skeleton className="h-4 rounded-xs" style={{ width: w.title }} />
            <Skeleton className="h-3 rounded-xs" style={{ width: w.sub }} />
          </div>
        ))}
      </div>
    </div>
  );
};
