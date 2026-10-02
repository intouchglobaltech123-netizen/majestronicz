/**
 * CRM-8: a customer's purchase count (which drives the loyalty reward) is the
 * number of their LIVE bills, read fresh — an older stored counter that
 * drifted no longer shows "Reward ready". Used by the bootstrap, /api/sync and
 * the live-update deltas a save returns (FIN-A-5), so every path agrees.
 */
export async function withLiveBillCounts<T extends { id: string }>(db: any, customers: T[], opts: { all?: boolean } = {}): Promise<T[]> {
  if (!customers.length) return customers;
  const counts = await db.invoice.groupBy({
    by: ['customerId'],
    where: {
      customerId: opts.all ? { not: null } : { in: customers.map((c) => c.id) },
      OR: [{ isVoided: null }, { isVoided: false }],
    },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c: any) => [c.customerId, c._count._all]));
  return customers.map((c) => ({ ...c, purchaseCount: byId.get(c.id) ?? 0 }));
}
