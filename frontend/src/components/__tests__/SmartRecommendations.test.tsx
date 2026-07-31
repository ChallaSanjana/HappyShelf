import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SmartRecommendations from '../sustainability/SmartRecommendations';
import { makeItem } from '../../test/fixtures';

/**
 * Pins the selection behaviour while the days-of-runway calculation moved to
 * the shared getDaysLeft.
 *
 * The subtle part is ordering: runway is rounded *before* filtering, so an
 * item with 7.25 days rounds to 7 and qualifies, while filtering the raw
 * value first would exclude it. That was the original behaviour and the
 * label ("7 days left") only agrees with the filter if rounding comes first.
 */
const item = (name: string, quantity: number, daily_usage: number) =>
  makeItem({ id: name, name, quantity, daily_usage });

const listedNames = () => screen.queryAllByRole('listitem').map((el) => el.textContent || '');

describe('SmartRecommendations', () => {
  test('includes an item with under a week of runway', () => {
    render(<SmartRecommendations items={[item('Milk', 3, 1)]} />);
    expect(screen.getByText(/Milk/)).toBeInTheDocument();
    expect(screen.getByText(/3 days left/)).toBeInTheDocument();
  });

  test('excludes an item with plenty of runway', () => {
    render(<SmartRecommendations items={[item('Rice', 100, 1)]} />);
    expect(screen.getByText(/No urgent actions recommended/)).toBeInTheDocument();
  });

  test('excludes an item that is never consumed', () => {
    // getDaysLeft returns Infinity; Math.round(Infinity) is Infinity, which
    // fails the <= 7 filter — same as the old `: Infinity` branch.
    render(<SmartRecommendations items={[item('Light bulbs', 5, 0)]} />);
    expect(screen.getByText(/No urgent actions recommended/)).toBeInTheDocument();
  });

  test('includes an item at exactly the 7-day boundary', () => {
    render(<SmartRecommendations items={[item('Eggs', 7, 1)]} />);
    expect(screen.getByText(/7 days left/)).toBeInTheDocument();
  });

  test('rounds before filtering, so 7.25 days still qualifies', () => {
    // 29 / 4 = 7.25 -> rounds to 7 -> included. Filtering the raw value
    // first would have dropped it; this pins the original ordering.
    render(<SmartRecommendations items={[item('Bread', 29, 4)]} />);
    expect(screen.getByText(/7 days left/)).toBeInTheDocument();
  });

  test('excludes 7.5 days, which rounds up to 8', () => {
    render(<SmartRecommendations items={[item('Butter', 15, 2)]} />);
    expect(screen.getByText(/No urgent actions recommended/)).toBeInTheDocument();
  });

  test('sorts most urgent first', () => {
    render(
      <SmartRecommendations
        items={[item('Later', 6, 1), item('Sooner', 1, 1), item('Middle', 4, 1)]}
      />
    );
    const names = listedNames();
    expect(names[0]).toMatch(/Sooner/);
    expect(names[1]).toMatch(/Middle/);
    expect(names[2]).toMatch(/Later/);
  });

  test('caps the list at six items', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`Item ${i}`, 1, 1));
    render(<SmartRecommendations items={items} />);
    expect(listedNames()).toHaveLength(6);
  });

  test('handles an empty inventory', () => {
    render(<SmartRecommendations items={[]} />);
    expect(screen.getByText(/No urgent actions recommended/)).toBeInTheDocument();
  });

  test('an out-of-stock item is surfaced with 0 days left', () => {
    render(<SmartRecommendations items={[item('Coffee', 0, 2)]} />);
    expect(screen.getByText(/0 days left/)).toBeInTheDocument();
  });
});
