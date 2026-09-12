import TokenSequence from "../models/TokenSequence.js";

export const getNextSequence = async ({
  dateKey,
  serviceId,
  prefix,
}) => {
  return TokenSequence.findOneAndUpdate(
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
};