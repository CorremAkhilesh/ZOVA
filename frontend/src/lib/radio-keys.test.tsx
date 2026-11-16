import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { onRadioGroupKeyDown } from './radio-keys';

function Group() {
  const [value, setValue] = useState('b');
  return (
    <div role="radiogroup" aria-label="Size" onKeyDown={onRadioGroupKeyDown}>
      {['a', 'b', 'c'].map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: the segmented control under test
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => setValue(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

describe('onRadioGroupKeyDown', () => {
  it('Tab enters on the chosen option; arrows, Home and End move and choose, wrapping', async () => {
    const user = userEvent.setup();
    render(<Group />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'b' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'c' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'c' })).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'a' })).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'c' })).toBeChecked();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'a' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'c' })).toBeChecked();
  });
});
