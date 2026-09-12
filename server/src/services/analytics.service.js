import Token from "../models/Token.js";

import Counter from "../models/Counter.js";

import Service from "../models/Service.js";

import { TOKEN_STATUS } from "../constants/queue.js";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

const dayFilter = () => ({
  createdAt: {
    $gte: startOfToday(),
    $lte: endOfToday(),
  },
});

/**
 * Today's high-level counters + computed metrics.
 */
export const getOverview = async () => {
  const todayFilter = dayFilter();

  const [waiting, serving, skipped, cancelled, completed, total, avgWaitAgg] =
    await Promise.all([
      Token.countDocuments({
        ...todayFilter,
        status: TOKEN_STATUS.WAITING,
      }),
      Token.countDocuments({
        ...todayFilter,
        status: {
          $in: [TOKEN_STATUS.CALLED, TOKEN_STATUS.SERVING],
        },
      }),
      Token.countDocuments({
        ...todayFilter,
        status: TOKEN_STATUS.SKIPPED,
      }),
      Token.countDocuments({
        ...todayFilter,
        status: TOKEN_STATUS.CANCELLED,
      }),
      Token.countDocuments({
        ...todayFilter,
        status: TOKEN_STATUS.COMPLETED,
      }),
      Token.countDocuments(todayFilter),
      Token.aggregate([
        {
          $match: {
            ...todayFilter,
            status: TOKEN_STATUS.COMPLETED,
            completedAt: { $exists: true, $ne: null },
            createdAt: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            avgWaitMs: { $avg: { $subtract: ["$completedAt", "$createdAt"] } },
          },
        },
      ]),
    ]);

  const avgWaitMinutes =
    avgWaitAgg.length > 0
      ? Math.round(avgWaitAgg[0].avgWaitMs / 60000)
      : 0;

  return {
    waiting,
    serving,
    completed,
    skipped,
    cancelled,
    total,
    avgWaitMinutes,
  };
};

/**
 * Per-service breakdown for today: waiting, completed,
 * average wait time and total tokens.
 */
export const getServiceBreakdown = async () => {
  const todayFilter = dayFilter();

  const rows = await Token.aggregate([
    {
      $match: {
        ...todayFilter,
        service: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: "$service",
        total: { $sum: 1 },
        waiting: {
          $sum: {
            $cond: [{ $eq: ["$status", TOKEN_STATUS.WAITING] }, 1, 0],
          },
        },
        completed: {
          $sum: {
            $cond: [{ $eq: ["$status", TOKEN_STATUS.COMPLETED] }, 1, 0],
          },
        },
        avgWaitMs: {
          $avg: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", TOKEN_STATUS.COMPLETED] },
                  { $ne: ["$completedAt", null] },
                  { $ne: ["$createdAt", null] },
                ],
              },
              { $subtract: ["$completedAt", "$createdAt"] },
              null,
            ],
          },
        },
      },
    },
  ]);

  const services = await Service.find({}).lean();

  const byId = new Map(services.map((s) => [String(s._id), s]));

  return rows
    .map((row) => {
      const service = byId.get(String(row._id));

      return {
        serviceId: row._id,
        service: service ? service.name : "Unknown",
        serviceCode: service ? service.code : "?",
        prefix: service ? service.prefix : "",
        waiting: row.waiting,
        completed: row.completed,
        total: row.total,
        avgWaitMinutes:
          row.completed > 0 && row.avgWaitMs != null
            ? Math.round(row.avgWaitMs / 60000)
            : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
};

/**
 * Hourly token-creation trend for today (24 buckets).
 */
export const getHourlyTrend = async () => {
  const rows = await Token.aggregate([
    {
      $match: dayFilter(),
    },
    {
      $group: {
        _id: { $hour: "$createdAt" },
        total: { $sum: 1 },
        completed: {
          $sum: {
            $cond: [{ $eq: ["$status", TOKEN_STATUS.COMPLETED] }, 1, 0],
          },
        },
      },
    },
  ]);

  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    total: 0,
    completed: 0,
  }));

  for (const row of rows) {
    const hour = row._id;
    if (hour >= 0 && hour < 24) {
      buckets[hour].total += row.total;
      buckets[hour].completed += row.completed;
    }
  }

  return buckets;
};

/**
 * Per-counter throughput for today.
 */
export const getCounterBreakdown = async () => {
  const todayFilter = dayFilter();

  const rows = await Token.aggregate([
    {
      $match: {
        ...todayFilter,
        counter: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: "$counter",
        completed: {
          $sum: {
            $cond: [{ $eq: ["$status", TOKEN_STATUS.COMPLETED] }, 1, 0],
          },
        },
        called: {
          $sum: {
            $cond: [
              { $in: ["$status", [TOKEN_STATUS.CALLED, TOKEN_STATUS.SERVING, TOKEN_STATUS.COMPLETED]] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const counters = await Counter.find({}).select("name number").lean();

  const byId = new Map(counters.map((c) => [String(c._id), c]));

  return rows
    .map((row) => {
      const counter = byId.get(String(row._id));

      return {
        counterId: row._id,
        counter: counter ? counter.name : "Unknown",
        counterNumber: counter ? counter.number : null,
        called: row.called,
        completed: row.completed,
      };
    })
    .sort((a, b) => b.completed - a.completed);
};
