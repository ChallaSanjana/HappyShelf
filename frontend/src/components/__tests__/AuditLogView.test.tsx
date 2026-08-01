import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import AuditLogView from '../AuditLogView';
import type { AuditLogEntry } from '../../services/api';

/**
 * The component's own fetch(), stubbed at the global level rather than
 * mocking services/api.ts — this is the same approach httpClient.test.ts
 * uses, and it exercises the real api.ts -> httpClient.ts -> fetch path
 * rather than a parallel test-only one.
 */
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit-1',
    householdId: 'household-1',
    actorId: 'user-1',
    actorName: 'Jane Admin',
    actorEmail: 'jane@example.com',
    action: 'item.created',
    targetType: 'item',
    targetId: 'item-1',
    targetName: 'Rice',
    details: { quantity: 12, unit: 'kg' },
    createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function page(entries: AuditLogEntry[], overrides: Partial<{ total: number; page: number; totalPages: number }> = {}) {
  return {
    entries,
    total: overrides.total ?? entries.length,
    page: overrides.page ?? 1,
    limit: 20,
    totalPages: overrides.totalPages ?? 1,
  };
}

describe('AuditLogView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders an entry with a human-readable label, actor and target', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, page([entry()]))));

    render(<AuditLogView />);

    expect(await screen.findByText('Item added')).toBeInTheDocument();
    expect(screen.getByText('Jane Admin')).toBeInTheDocument();
    expect(screen.getByText('Rice')).toBeInTheDocument();
    expect(screen.getByText(/quantity: 12/)).toBeInTheDocument();
  });

  test('an action with no mapped label still renders, humanised', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, page([entry({ action: 'household.some_future_action' })])))
    );

    render(<AuditLogView />);

    // "household.some_future_action" -> "Some future action" (the part after
    // the dot, underscores replaced, capitalised) rather than a crash or the
    // raw code.
    expect(await screen.findByText('Some future action')).toBeInTheDocument();
  });

  test('an entry with no actor (a password-reset request) shows "System"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          200,
          page([
            entry({
              action: 'account.password_reset_requested',
              actorId: null,
              actorName: null,
              actorEmail: null,
              targetType: 'account',
              targetName: 'Jane Admin',
            }),
          ])
        )
      )
    );

    render(<AuditLogView />);
    expect(await screen.findByText('System')).toBeInTheDocument();
  });

  test('an entry with no details shows an em dash rather than an empty cell', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, page([entry({ details: {} })]))));

    render(<AuditLogView />);
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  test('shows an empty state when there are no entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, page([]))));

    render(<AuditLogView />);
    expect(await screen.findByText(/No audit log entries yet/)).toBeInTheDocument();
  });

  test('a failed load shows the retry banner, and retry re-fetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, { error: 'Forbidden' }))
      .mockResolvedValueOnce(jsonResponse(200, page([entry()])));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuditLogView />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Could not load the audit log/);

    await act(async () => {
      screen.getByRole('button', { name: /Retry/i }).click();
    });

    // 'Item added' is ambiguous here — it is also the text of the action
    // filter's dropdown option, which is always rendered regardless of
    // entries. The target name is unique to the loaded row.
    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('paging forward requests the next page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, page([entry({ id: 'e1' })], { total: 25, totalPages: 2 })))
      .mockResolvedValueOnce(
        jsonResponse(200, page([entry({ id: 'e2', targetName: 'Milk' })], { total: 25, page: 2, totalPages: 2 }))
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuditLogView />);
    await screen.findByText('Rice');

    await act(async () => {
      screen.getByRole('button', { name: /Next/i }).click();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain('/audit-log');
    expect(secondCallUrl).toContain('page=2');
    expect(await screen.findByText('Milk')).toBeInTheDocument();
  });

  test('choosing a filter requests that action and resets to page 1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page([entry()])));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuditLogView />);
    await screen.findByText('Rice');

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by action'), { target: { value: 'item.deleted' } });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const filteredUrl = String(fetchMock.mock.calls[1][0]);
    expect(filteredUrl).toContain('action=item.deleted');
    expect(filteredUrl).toContain('page=1');
  });
});
