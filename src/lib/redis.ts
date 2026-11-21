import { Redis } from "ioredis";
import { config } from "../config";

// BullMQ requires maxRetriesPerRequest to be null on its connections.
export function createRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

export const redis = createRedisConnection();
