const mockGetSession = jest.fn();
const mockRpc = jest.fn();
const mockBoundRpc = jest.fn(async () => ({ data: 'plan', error: null }));
const mockClientForAccessToken = jest.fn((_token: string) => ({ rpc: mockBoundRpc }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() }, rpc: (...args: unknown[]) => mockRpc(...args) },
  clientForAccessToken: (token: string) => mockClientForAccessToken(token),
}));
import { saveTrainingPlan } from '@/lib/db/plan-preferences';
import { trainingPreferences } from '@/lib/plan/preferences';

beforeEach(() => { jest.clearAllMocks(); });
it('rejects stale account UI before a plan can be written to the next account', async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'B' }, access_token: 'B-token' } }, error: null });
  await expect(saveTrainingPlan('A', trainingPreferences(null), { name: 'A', split: 'Full', weeks: 4, days: [] }))
    .rejects.toThrow('Account changed');
  expect(mockClientForAccessToken).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockBoundRpc).not.toHaveBeenCalled();
});
it('freezes the checked owner token for the entire RPC', async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'A' }, access_token: 'A-token' } }, error: null });
  await saveTrainingPlan('A', trainingPreferences(null), { name: 'A', split: 'Full', weeks: 4, days: [] });
  expect(mockClientForAccessToken).toHaveBeenCalledWith('A-token');
  expect(mockBoundRpc).toHaveBeenCalledWith('save_training_plan', expect.any(Object));
  expect(mockRpc).not.toHaveBeenCalled();
});
