import { db, isPostgresConfigured } from './index.ts';
import { users } from './schema.ts';
import { eq } from 'drizzle-orm';

const memoryUsers = new Map<string, any>();

export async function getOrCreateUser(uid: string, email: string, displayName?: string) {
  const existing = memoryUsers.get(uid);
  const userObj = {
    id: existing?.id || memoryUsers.size + 1,
    uid,
    email,
    displayName: displayName || email.split('@')[0] || 'Student',
    role: 'student',
    targetExam: 'JEE_MAIN',
    createdAt: existing?.createdAt || new Date(),
  };
  memoryUsers.set(uid, userObj);

  if (isPostgresConfigured()) {
    try {
      const result = await db
        .insert(users)
        .values({
          uid,
          email,
          displayName: userObj.displayName,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email,
            ...(displayName ? { displayName } : {}),
          },
        })
        .returning();

      if (result[0]) return result[0];
    } catch (error) {
      console.warn('PostgreSQL note in getOrCreateUser, using memory fallback:', error);
    }
  }

  return userObj;
}

export async function getUserByUid(uid: string) {
  if (memoryUsers.has(uid)) {
    return memoryUsers.get(uid);
  }

  if (isPostgresConfigured()) {
    try {
      const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
      if (rows[0]) {
        memoryUsers.set(uid, rows[0]);
        return rows[0];
      }
    } catch (error) {
      console.warn('PostgreSQL note in getUserByUid, using memory fallback:', error);
    }
  }

  return null;
}

