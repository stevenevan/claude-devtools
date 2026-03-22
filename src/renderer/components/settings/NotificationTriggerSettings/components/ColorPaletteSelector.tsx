/**
 * ColorPaletteSelector - Color picker with preset palette and custom hex input.
 * Renders a row of preset colored circles plus a hex input for custom colors.
 *
 * Hex input commits on blur/Enter only (not on every keystroke) to avoid
 * triggering config saves while the user is still typing.
 */

import { useCallback, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import {
  isPresetColorKey,
  resolveColorHex,
  TRIGGER_COLORS,
  type TriggerColor,
} from '@shared/constants/triggerColors';

interface ColorPaletteSelectorProps {
  value: TriggerColor | undefined;
  onChange: (color: TriggerColor) => void;
  disabled?: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

export const ColorPaletteSelector = ({
  value,
  onChange,
  disabled,
}: Readonly<ColorPaletteSelectorProps>): React.JSX.Element => {
  const isCustom = !!value && !isPresetColorKey(value);
  const [hexInput, setHexInput] = useState(isCustom ? value : '');
  const [showHexInput, setShowHexInput] = useState(isCustom);

  // Only update local state on each keystroke — do NOT call onChange here.
  const handleHexInputChange = useCallback((raw: string) => {
    const v = raw.startsWith('#') ? raw : raw.length > 0 ? `#${raw}` : '';
    setHexInput(v);
  }, []);

  // Commit hex value on blur or Enter
  const commitHex = useCallback(() => {
    if (hexInput && HEX_RE.test(hexInput)) {
      onChange(hexInput as `#${string}`);
    }
  }, [hexInput, onChange]);

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitHex();
      }
    },
    [commitHex]
  );

  const handlePresetClick = useCallback(
    (color: TriggerColor) => {
      onChange(color);
      setShowHexInput(false);
    },
    [onChange]
  );

  const handleCustomClick = useCallback(() => {
    setShowHexInput(true);
    if (hexInput && HEX_RE.test(hexInput)) {
      onChange(hexInput as `#${string}`);
    }
  }, [hexInput, onChange]);

  // Preview swatch shows live hex input (local state) when typing, otherwise the committed value
  const previewHex =
    showHexInput && hexInput && HEX_RE.test(hexInput) ? hexInput : resolveColorHex(value);

  return (
    <div className={cn('space-y-2', disabled && 'pointer-events-none opacity-50')}>
      {/* Color preview + presets row */}
      <div className="flex items-center gap-2">
        {/* Live preview swatch */}
        <span
          className="border-border/50 size-6 shrink-0 rounded-sm border"
          style={{ backgroundColor: previewHex }}
          title={value ?? 'red'}
        />

        {/* Preset palette */}
        {TRIGGER_COLORS.map((color) => {
          const isSelected = value === color.key || (!value && color.key === 'red');
          return (
            <button
              key={color.key}
              type="button"
              title={color.label}
              onClick={() => handlePresetClick(color.key as TriggerColor)}
              disabled={disabled}
              className={cn(
                'size-5 rounded-full transition-all',
                isSelected
                  ? 'ring-offset-background ring-2 ring-white/60 ring-offset-1'
                  : 'hover:ring-1 hover:ring-white/30'
              )}
              style={{ backgroundColor: color.hex }}
            />
          );
        })}

        {/* Custom hex toggle */}
        <button
          type="button"
          title="Custom hex color"
          onClick={handleCustomClick}
          disabled={disabled}
          className={cn(
            'flex size-5 items-center justify-center rounded-full border text-[9px] leading-none font-bold transition-all',
            isCustom
              ? 'ring-offset-background border-white/40 text-white ring-2 ring-white/60 ring-offset-1'
              : 'border-border text-muted-foreground hover:ring-1 hover:ring-white/30'
          )}
          style={isCustom ? { backgroundColor: resolveColorHex(value) } : undefined}
        >
          {isCustom ? '' : '#'}
        </button>
      </div>

      {/* Hex input row */}
      {showHexInput && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={hexInput}
            onChange={(e) => handleHexInputChange(e.target.value)}
            onBlur={commitHex}
            onKeyDown={handleHexKeyDown}
            placeholder="#ff6600"
            maxLength={9}
            disabled={disabled}
            className={cn(
              'text-foreground placeholder:text-muted-foreground w-24 rounded-sm border bg-transparent px-2 py-1 font-mono text-xs focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
              hexInput && !HEX_RE.test(hexInput) ? 'border-red-500' : 'border-border'
            )}
          />
          {hexInput && !HEX_RE.test(hexInput) && (
            <span className="text-xs text-red-400">Invalid hex</span>
          )}
        </div>
      )}
    </div>
  );
};
