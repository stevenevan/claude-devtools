export const ANNOTATION_COLORS = [
  { id: 'amber', label: 'Amber', hex: '#f59e0b' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'emerald', label: 'Emerald', hex: '#10b981' },
  { id: 'pink', label: 'Pink', hex: '#ec4899' },
  { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
] as const;

export type AnnotationColorId = (typeof ANNOTATION_COLORS)[number]['id'];

export function getAnnotationColorHex(colorId: string): string {
  return ANNOTATION_COLORS.find((c) => c.id === colorId)?.hex ?? ANNOTATION_COLORS[0].hex;
}
