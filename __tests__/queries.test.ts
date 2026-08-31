const mockChain = {
  update: jest.fn(),
  eq: jest.fn(),
  is: jest.fn(),
};
mockChain.update.mockReturnValue(mockChain);
mockChain.eq.mockReturnValue(mockChain);

jest.mock('@/lib/db/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(() => mockChain) },
}));

import { finishSession, savePlan } from '@/lib/db/queries';
import { supabase } from '@/lib/db/supabase';

const mockRpc = jest.mocked(supabase.rpc);

describe('savePlan', () => {
  it('uses the atomic save_plan RPC once', async () => {
    mockRpc.mockResolvedValue({ data: 'plan-1', error: null } as never);

    await expect(savePlan('ignored-user-id', {
      name: 'Test', split: 'Full body', weeks: 4, days: [],
    } as never)).resolves.toBe('plan-1');

    expect(mockRpc).toHaveBeenCalledWith('save_plan', {
      plan: { name: 'Test', split: 'Full body', weeks: 4, days: [] },
    });
  });
});

describe('finishSession', () => {
  it('only completes an unfinished session so replay cannot change it', async () => {
    mockChain.is.mockResolvedValue({ error: null });

    await finishSession('session-1', { duration_s: 90, rpe: null });

    expect(mockChain.is).toHaveBeenCalledWith('completed_at', null);
  });
});
