import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Button } from '@renderer/components/ui/button';

import { expectNoA11yViolations } from './helpers';

describe('Button a11y', () => {
  it('has no violations with text content', async () => {
    const { container } = render(<Button>Save</Button>);
    await expectNoA11yViolations(container);
  });

  it('has no violations when disabled', async () => {
    const { container } = render(<Button disabled>Disabled</Button>);
    await expectNoA11yViolations(container);
  });

  it('has no violations for destructive variant', async () => {
    const { container } = render(<Button variant="destructive">Delete</Button>);
    await expectNoA11yViolations(container);
  });

  it('has no violations for icon-only with aria-label', async () => {
    const { container } = render(
      <Button size="icon" aria-label="Close">
        X
      </Button>
    );
    await expectNoA11yViolations(container);
  });
});
