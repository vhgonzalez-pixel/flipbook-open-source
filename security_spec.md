# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path under `/databases/{database}/documents` is denied unless explicitly matched and authorized.
2. **Verified Individual Ownership**: All reads, list queries, creates, updates, and deletes under `/users/{userId}/...` require `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
3. **Immutable Ownership & Creation Timestamps**: `ownerId` and `createdAt` cannot be modified after creation (`incoming().ownerId == existing().ownerId`, `incoming().createdAt == existing().createdAt`).
4. **Server-Enforced Timestamps**: `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
5. **Strict Key & Size Guards**: Every document enforces `hasAll` + `hasOnly` on creation, `affectedKeys().hasOnly(...)` on update, `isValidId()` on path variables, and `.size()` limits on every string and array.
6. **PII Isolation**: User email and displayName live exclusively in `/users/{userId}/private/profile` with zero public or cross-user access.
7. **Secure List Queries**: `allow list` explicitly checks `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Delete**: Anonymous caller attempts `delete` on `/users/userA/publications/pub1` -> `PERMISSION_DENIED`.
2. **Cross-User Delete**: Authenticated `userB` attempts `delete` on `/users/userA/publications/pub1` -> `PERMISSION_DENIED`.
3. **Unverified Email Write**: Authenticated `userA` with `email_verified: false` attempts `create` on `/users/userA/publications/pub1` -> `PERMISSION_DENIED`.
4. **Identity Spoofing on Create**: `userA` attempts `create` on `/users/userA/publications/pub1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: `userA` sends valid `CloudPublication` plus `{ isAdmin: true }` -> `PERMISSION_DENIED` (`hasOnly` rejects).
6. **ID Poisoning (Oversized / Invalid Path ID)**: `userA` attempts `create` at `/users/userA/publications/bad$id_or_200chars` -> `PERMISSION_DENIED` (`isValidId` rejects).
7. **Client-Forged Timestamp**: `userA` sends `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: `userA` attempts `update` changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
9. **Value Poisoning on Update**: `userA` attempts `update` setting `titulo` to empty string `""` or >140 chars or non-string -> `PERMISSION_DENIED`.
10. **Invalid / Non-HTTPS PDF URL**: `userA` attempts `create` with `rutaPdf: "javascript:alert(1)"` -> `PERMISSION_DENIED`.
11. **Unbounded Array Exhaustion**: `userA` attempts `set` on `/users/userA/preferences/catalog` with 51 items in `hiddenBuiltinKeys` -> `PERMISSION_DENIED`.
12. **Cross-User PII Read / Blanket List**: `userB` attempts `get` on `/users/userA/private/profile` or `list` on `/users/userA/publications` -> `PERMISSION_DENIED`.

## 3. Verification
See `firestore.rules.test.ts` for executable validation checks corresponding to these 12 adversarial payloads.
