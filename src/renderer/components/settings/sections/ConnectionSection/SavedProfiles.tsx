import type { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { Server } from 'lucide-react';

import type { SshConnectionProfile } from '@shared/types';

interface SavedProfilesProps {
  profiles: SshConnectionProfile[];
  selectedProfileId: string | null;
  onSelect: (profile: SshConnectionProfile) => void;
}

export const SavedProfiles = ({
  profiles,
  selectedProfileId,
  onSelect,
}: SavedProfilesProps): JSX.Element | null => {
  if (profiles.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-sm font-medium">Saved Profiles</h3>
      <div className="flex flex-wrap gap-2">
        {profiles.map((profile) => {
          const isSelected = selectedProfileId === profile.id;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                isSelected
                  ? 'border-indigo-500/40 bg-indigo-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-card'
              )}
            >
              <Server
                className={cn('size-3.5', isSelected ? 'text-indigo-400' : 'text-muted-foreground')}
              />
              <span>{profile.name}</span>
              <span className="text-muted-foreground text-xs">
                {profile.username}@{profile.host}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
