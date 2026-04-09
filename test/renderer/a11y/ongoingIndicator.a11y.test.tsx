import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import { OngoingBanner, OngoingIndicator } from '@renderer/components/common/OngoingIndicator';

import { expectNoA11yViolations } from './helpers';

describe('OngoingIndicator a11y', () => {
  it('has no violations with title attribute', async () => {
    const { container } = render(<OngoingIndicator />);
    await expectNoA11yViolations(container);
  });

  it('has no violations with label shown', async () => {
    const { container } = render(<OngoingIndicator showLabel />);
    await expectNoA11yViolations(container);
  });
});

describe('OngoingBanner a11y', () => {
  it('has no violations', async () => {
    const { container } = render(<OngoingBanner />);
    await expectNoA11yViolations(container);
  });
});
