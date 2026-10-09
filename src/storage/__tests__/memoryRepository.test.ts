import { createMemoryIncidentRepository } from '../memoryRepository';
import { describeRepositoryContract } from '../testing/repositoryContract';

describeRepositoryContract('in-memory (Demo store)', () => ({
  open: async () => createMemoryIncidentRepository(),
  close: async () => undefined,
}));

describe('in-memory repositories are isolated from each other', () => {
  it('does not share data between instances', async () => {
    const a = createMemoryIncidentRepository();
    const b = createMemoryIncidentRepository();
    expect(await a.recordInbound('pkt-1')).toBe('new');
    expect(await b.recordInbound('pkt-1')).toBe('new');
  });
});
