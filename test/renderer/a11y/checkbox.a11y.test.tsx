import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Checkbox } from '@renderer/components/ui/checkbox';

import { expectNoA11yViolations } from './helpers';

describe('Checkbox a11y', () => {
  it('has no violations with aria-label', async () => {
    const { container } = render(<Checkbox aria-label="Accept terms" />);
    await expectNoA11yViolations(container);
  });

  it('has no violations when checked', async () => {
    const { container } = render(<Checkbox defaultChecked aria-label="Accepted" />);
    await expectNoA11yViolations(container);
  });

  it('has no violations when disabled', async () => {
    const { container } = render(<Checkbox disabled aria-label="Disabled" />);
    await expectNoA11yViolations(container);
  });
});
