export {};

declare global {
  namespace Express {
    interface Request {
      sessionUser?: {
        sid: string;
        userId: number;
        username: string;
        role: string;
        sessionVersion: number;
        createdAt?: number;
        lastSeenAt?: number;
      };
    }
  }
}
