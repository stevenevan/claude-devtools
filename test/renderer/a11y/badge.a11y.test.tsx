import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Badge } from '@renderer/components/ui/badge';

import { expectNoA11yViolations } from './helpers';

describe('Badge a11y', () => {
  it('has no violations in default variant', async () => {
    const { container } = render(<Badge>New</Badge>);
    await expectNoA11yViolations(container);
  });

  it('has no violations in outline variant', async () => {
    const { container } = render(<Badge variant="outline">v2.0</Badge>);
    await expectNoA11yViolations(container);
  });

  it('has no violations in destructive variant', async () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>);
    await expectNoA11yViolations(container);
  });
});
