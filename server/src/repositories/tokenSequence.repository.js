import TokenSequence from "../models/TokenSequence.js";

/**
 * Atomically advance the daily sequence for a service and date.
 *
 * Uses a single findOneAndUpdate with $inc + $setOnInsert so the
 * increment is atomic against concurrent writers. When two requests
 * race to upsert the very first document for a (dateKey, service)
 * pair, the loser can hit a duplicate-key error on the unique index
 * (MongoDB retries this internally on replica sets with retryable
 * writes, but a standalone instance needs an explicit retry). Each
 * retry simply re-runs the atomic increment against the doc that
 * won the race, so no sequence number is ever handed out twice.
 */
export const getNextSequence = async ({
  dateKey,
  serviceId,
  prefix,
}) => {
  const MAX_ATTEMPTS = 3;

  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await TokenSequence.findOneAndUpdate(
        {
          dateKey,
          service: serviceId,
        },
        {
          $inc: {
            sequence: 1,
          },

          $setOnInsert: {
            dateKey,
            service: serviceId,
            prefix,
          },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
          returnDocument: "after",
        }
      );
    } catch (error) {
      if (
        error?.code === 11000 &&
        attempt < MAX_ATTEMPTS - 1
      ) {
        lastError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastError;
};
