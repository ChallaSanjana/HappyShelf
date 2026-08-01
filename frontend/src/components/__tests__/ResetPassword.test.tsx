import { describe, test, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import ResetPassword from '../ResetPassword';

/**
 * The one piece of logic here that E2E is unlikely to catch by accident:
 * E2E scripts naturally submit two matching passwords, so a broken mismatch
 * guard would never surface there. That guard runs entirely client-side —
 * it must reject the submission before authApi.resetPassword is ever called.
 */

function fill(id: string, value: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
}

describe('ResetPassword', () => {
  test('mismatched passwords are rejected without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPassword token="a-real-token" onDone={() => {}} />);

    fill('reset-password', 'FirstPassw0rd');
    fill('reset-confirm-password', 'SecondPassw0rd');

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /Update password/i }).closest('form')!);
    });

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a missing token disables the form and explains why', () => {
    render(<ResetPassword token={null} onDone={() => {}} />);

    expect(screen.getByText(/missing its reset token/i)).toBeInTheDocument();
    expect(document.getElementById('reset-password')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Update password/i })).toBeDisabled();
  });

  test('a successful reset shows the success state, not the form', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Password updated.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPassword token="a-real-token" onDone={() => {}} />);

    fill('reset-password', 'MatchingPassw0rd');
    fill('reset-confirm-password', 'MatchingPassw0rd');

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /Update password/i }).closest('form')!);
    });

    expect(await screen.findByRole('button', { name: /Go to sign in/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
  });
});
