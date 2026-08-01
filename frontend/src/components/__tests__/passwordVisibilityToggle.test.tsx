import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AuthProvider } from '../../contexts/AuthContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { Login } from '../Login';
import { Register } from '../Register';
import AddMemberForm from '../AddMemberForm';
import ResetPassword from '../ResetPassword';

/**
 * The show/hide password control, on every form that takes a password.
 *
 * All four are asserted together rather than only the two just added: the
 * point of the control is that it behaves the same everywhere, and the two
 * that already existed had no test at all.
 *
 * Each case checks the input's `type` rather than anything visual — that
 * attribute is what actually determines whether the value is legible, and
 * asserting on the icon would pass even if the toggle were wired to nothing.
 */

function toggleIn(container: HTMLElement) {
  return within(container).getByRole('button', { name: /Show password|Hide password/i });
}

describe('password visibility toggle', () => {
  test('Login: reveals and re-hides the password', () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <Login onToggle={() => {}} onForgotPassword={() => {}} />
        </AuthProvider>
      </ToastProvider>
    );

    const input = document.getElementById('login-password') as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('text');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('password');
  });

  test('Register: reveals and re-hides the password', () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <Register onToggle={() => {}} />
        </AuthProvider>
      </ToastProvider>
    );

    const input = document.getElementById('register-password') as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('text');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('password');
  });

  test('Add team member: reveals and re-hides the password', () => {
    render(
      <ToastProvider>
        <AddMemberForm assignableRoles={['Staff', 'Viewer']} onAdd={() => {}} />
      </ToastProvider>
    );

    const input = screen.getByPlaceholderText(/Password \(min 8 chars\)/) as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('text');

    fireEvent.click(toggleIn(document.body));
    expect(input.type).toBe('password');
  });

  test('Reset password: one toggle governs both the new and confirm fields', () => {
    render(<ResetPassword token="a-real-token" onDone={() => {}} />);

    const password = document.getElementById('reset-password') as HTMLInputElement;
    const confirm = document.getElementById('reset-confirm-password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(confirm.type).toBe('password');

    fireEvent.click(toggleIn(document.body));
    // Revealing one and not the other would make comparing them pointless.
    expect(password.type).toBe('text');
    expect(confirm.type).toBe('text');
  });

  test('the control announces its state to assistive tech', () => {
    render(
      <ToastProvider>
        <AuthProvider>
          <Register onToggle={() => {}} />
        </AuthProvider>
      </ToastProvider>
    );

    const button = screen.getByRole('button', { name: 'Show password' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);

    const pressed = screen.getByRole('button', { name: 'Hide password' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  test('the toggle never submits the form it sits inside', () => {
    // Without type="button" it would default to submit, so revealing the
    // password would fire an incomplete registration.
    let submitted = false;
    render(
      <ToastProvider>
        <AuthProvider>
          <form onSubmit={() => { submitted = true; }}>
            <Register onToggle={() => {}} />
          </form>
        </AuthProvider>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(submitted).toBe(false);
  });
});
