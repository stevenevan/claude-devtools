import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { Switch } from '@renderer/components/ui/switch';

import { expectNoA11yViolations } from './helpers';

describe('Switch a11y', () => {
  it('has no violations with aria-label', async () => {
    const { container } = render(<Switch aria-label="Dark mode" />);
    await expectNoA11yViolations(container);
  });

  it('has no violations when checked', async () => {
    const { container } = render(<Switch defaultChecked aria-label="Enabled" />);
    await expectNoA11yViolations(container);
  });

  it('has no violations with sm size', async () => {
    const { container } = render(<Switch size="sm" aria-label="Small toggle" />);
    await expectNoA11yViolations(container);
  });
});
