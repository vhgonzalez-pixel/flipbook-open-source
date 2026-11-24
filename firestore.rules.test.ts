// Executable validation specification for the Dirty Dozen security payloads.
// Mirrors the exact field constraints in firebase-blueprint.json and firestore.rules.

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Delete',
    operation: 'delete',
    path: '/users/userA/publications/pub1',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-User Delete',
    operation: 'delete',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userB', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Write',
    operation: 'create',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: false },
    payload: { ownerId: 'userA', titulo: 'Revista', rutaPdf: 'https://example.com/a.pdf' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity Spoofing on Create',
    operation: 'create',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userB', titulo: 'Revista', rutaPdf: 'https://example.com/a.pdf' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection',
    operation: 'create',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', titulo: 'Revista', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning',
    operation: 'create',
    path: '/users/userA/publications/invalid$id',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', titulo: 'Revista' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client-Forged Timestamp',
    operation: 'create',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable Field Mutation',
    operation: 'update',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Value Poisoning on Update',
    operation: 'update',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { titulo: '' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Invalid Non-HTTPS PDF URL',
    operation: 'create',
    path: '/users/userA/publications/pub1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', rutaPdf: 'javascript:alert(1)' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded Array Exhaustion',
    operation: 'create',
    path: '/users/userA/preferences/catalog',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', hiddenBuiltinKeys: Array.from({ length: 51 }, (_, i) => `k${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Cross-User PII Read',
    operation: 'get',
    path: '/users/userA/private/profile',
    auth: { uid: 'userB', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Anonymous Shared Publication List Scrape',
    operation: 'list',
    path: '/sharedPublications',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Cross-User Shared Publication Delete',
    operation: 'delete',
    path: '/sharedPublications/sh-abc123',
    auth: { uid: 'userB', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Shared Chunk Index Out Of Bounds',
    operation: 'create',
    path: '/sharedPublications/sh-abc123/chunks/30',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', shareId: 'sh-abc123', index: 30 },
    expected: 'PERMISSION_DENIED',
  },
];
