import * as React from 'react';

import { Field as FieldPrimitive } from '@base-ui/react/field';
import { cn } from '@renderer/lib/utils';

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn('group/field flex flex-col gap-1.5', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        'text-xs leading-none font-medium text-foreground group-data-[disabled=true]/field:pointer-events-none group-data-[disabled=true]/field:opacity-50',
        className
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cn('text-xs text-destructive', className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldLabel };
