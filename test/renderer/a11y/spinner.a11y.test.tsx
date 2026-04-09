import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Spinner } from '@renderer/components/ui/spinner';

import { expectNoA11yViolations } from './helpers';

describe('Spinner a11y', () => {
  it('has no violations with role=status and aria-label', async () => {
    const { container } = render(<Spinner />);
    await expectNoA11yViolations(container);
  });

  it('has no violations with custom class', async () => {
    const { container } = render(<Spinner className="size-8" />);
    await expectNoA11yViolations(container);
  });
});
