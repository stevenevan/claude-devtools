import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Input } from '@renderer/components/ui/input';

import { expectNoA11yViolations } from './helpers';

describe('Input a11y', () => {
  it('has no violations with aria-label', async () => {
    const { container } = render(<Input aria-label="Search" />);
    await expectNoA11yViolations(container);
  });

  it('has no violations with associated label', async () => {
    const { container } = render(
      <div>
        <label htmlFor="email">Email</label>
        <Input id="email" type="email" />
      </div>
    );
    await expectNoA11yViolations(container);
  });

  it('has no violations when disabled', async () => {
    const { container } = render(<Input aria-label="Disabled" disabled />);
    await expectNoA11yViolations(container);
  });
});
