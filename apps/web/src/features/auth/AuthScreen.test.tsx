import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signInWithGoogle = vi.fn();
const signInWithPassword = vi.fn();
const signUp = vi.fn();
const resetPassword = vi.fn();
const consumeAuthError = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    auth: { signInWithGoogle, signInWithPassword, signUp, resetPassword },
    consumeAuthError,
  };
});

const { AuthScreen } = await import('./AuthScreen');

beforeEach(() => {
  for (const fn of [signInWithGoogle, signInWithPassword, signUp, resetPassword]) fn.mockReset();
  consumeAuthError.mockReset().mockReturnValue(null);
  for (const fn of [signInWithPassword, signUp, resetPassword]) fn.mockResolvedValue({ error: null });
});

const fill = async (email: string, password?: string) => {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  if (password !== undefined) await userEvent.type(screen.getByLabelText(/password/i), password);
};

it('offers Google as the first-class way in', async () => {
  render(<AuthScreen />);
  await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  expect(signInWithGoogle).toHaveBeenCalled();
});

it('signs in with an email and password', async () => {
  render(<AuthScreen />);
  await fill('ann@example.com', 'a-long-password');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith('ann@example.com', 'a-long-password'));
});

it('reports a refused sign-in instead of appearing to do nothing', async () => {
  signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
  render(<AuthScreen />);
  await fill('ann@example.com', 'wrong-password');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
});

it('switches to creating an account and back', async () => {
  render(<AuthScreen />);
  await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
  await fill('new@example.com', 'a-long-password');
  const submit = screen.getByRole('button', { name: /^create account$/i });
  await userEvent.click(submit);
  await waitFor(() => expect(signUp).toHaveBeenCalledWith('new@example.com', 'a-long-password'));
});

it('sends a reset link without asking for a password', async () => {
  render(<AuthScreen />);
  await userEvent.click(screen.getByRole('button', { name: /forgot/i }));
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  await fill('ann@example.com');
  await userEvent.click(screen.getByRole('button', { name: /send|reset/i }));
  await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('ann@example.com'));
});

/** An OAuth redirect can come back with an error in the URL; it must not be swallowed. */
it('surfaces an error carried back from an OAuth redirect', async () => {
  consumeAuthError.mockReturnValue('Your session expired, sign in again');
  render(<AuthScreen />);
  expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
});

it('requires a password of a sane length when signing up', async () => {
  render(<AuthScreen />);
  await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('minLength', '8');
});

it('never renders the password as readable text', async () => {
  render(<AuthScreen />);
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
});
