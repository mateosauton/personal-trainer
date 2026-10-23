const mockWriteRpc = jest.fn();
const mockPlanClient = jest.fn((_token: string) => ({ rpc: mockWriteRpc }));
const mockChain = {
  update: jest.fn(),
  eq: jest.fn(),
  is: jest.fn(),
};
mockChain.update.mockReturnValue(mockChain);
mockChain.eq.mockReturnValue(mockChain);

jest.mock('@/lib/db/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(() => mockChain),
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'owner' }, access_token: 'owner-token' } }, error: null })) } },
  clientForAccessToken: (token: string) => mockPlanClient(token),
}));

import { finishSession, savePlan } from '@/lib/db/queries';
import { supabase } from '@/lib/db/supabase';

const mockRpc = mockWriteRpc;

describe('savePlan', () => {
  it('uses the atomic save_plan RPC once', async () => {
    mockRpc.mockResolvedValue({ data: 'plan-1', error: null } as never);

    await expect(savePlan('owner', {
      name: 'Test', split: 'Full body', weeks: 4, days: [],
    } as never)).resolves.toBe('plan-1');

    expect(mockPlanClient).toHaveBeenCalledWith('owner-token');
    expect(supabase.rpc).not.toHaveBeenCalled();
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
